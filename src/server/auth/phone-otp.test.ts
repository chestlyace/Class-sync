import { eq, like } from 'drizzle-orm'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { CLIENT_IP_HEADER } from '@/lib/client-ip'
import { config, setConfigForTests } from '@/server/core/config'
import type { Db } from '@/server/db'
import { rateLimit, user, verification, whatsappMessage, whatsappMonthUsage } from '@/server/db/schema'
import { setWhatsAppProviderForTests, type TemplateMessage } from '@/server/whatsapp/provider'
import { makeUser } from '@/test/factories'
import { createTestDb } from '@/test/db'
import { createAuth } from './auth'
import { checkCodeLimits, codesAvailableToday, CodeLimitedError, hitCodeLimits, resetCodesAvailableToday, sendVerificationCode } from './phone-otp'

const AT = new Date('2026-11-25T12:00:00Z')
const secondsAfter = (s: number) => new Date(AT.getTime() + s * 1000)
const phoneN = (n: number) => `+2376${String(n).padStart(8, '0')}`

type Sent = { to: string; msg: TemplateMessage }

function captureProvider(options: { failWith?: Error } = {}) {
  const sent: Sent[] = []
  setWhatsAppProviderForTests({
    async sendTemplate(to, msg) {
      if (options.failWith) throw options.failWith
      sent.push({ to, msg })
      return { messageId: `wamid.${sent.length}` }
    },
    async sendText() {
      return { messageId: 'text' }
    },
  })
  return sent
}

afterEach(() => {
  setWhatsAppProviderForTests(null)
  vi.unstubAllEnvs()
})

/** Claims one code for each of `phones` as `userId`, one second apart. */
async function claimCodes(db: Db, phones: string[], userId: string | null, ip: string | null = null) {
  for (const [i, phone] of phones.entries()) await hitCodeLimits(db, { phone, userId, ip, at: secondsAfter(i) })
}

describe('code limits', () => {
  let db: Db
  beforeEach(async () => {
    db = await createTestDb()
  })

  it('allows one code per number per 60 seconds, and reports the wait', async () => {
    const input = { phone: phoneN(1), userId: null, ip: '10.0.0.1', at: AT }
    expect(await checkCodeLimits(db, input)).toEqual({ ok: true })
    await hitCodeLimits(db, input)
    expect(await checkCodeLimits(db, { ...input, at: secondsAfter(30) })).toEqual({ ok: false, reason: 'cooldown', retryAfter: 30 })
    // Not a fixed window: 2 seconds later is still inside the 60 seconds, wherever the clock minute falls.
    expect(await checkCodeLimits(db, { ...input, at: secondsAfter(2) })).toMatchObject({ ok: false, reason: 'cooldown' })
    expect(await checkCodeLimits(db, { ...input, at: secondsAfter(61) })).toEqual({ ok: true })
  })

  it('lets only one of two simultaneous requests for a number take the slot', async () => {
    const input = { phone: phoneN(1), userId: null, ip: '10.0.0.1', at: AT }
    const results = await Promise.allSettled([hitCodeLimits(db, input), hitCodeLimits(db, input)])
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1)
    const rejected = results.find((r) => r.status === 'rejected') as PromiseRejectedResult
    expect(rejected.reason).toBeInstanceOf(CodeLimitedError)
    expect((rejected.reason as CodeLimitedError).reason).toBe('cooldown')
  })

  it('stops the 6th code to one number in a day', async () => {
    const base = { phone: phoneN(1), userId: null, ip: '10.0.0.1' }
    for (let i = 0; i < 5; i++) {
      const at = secondsAfter(i * 61)
      expect(await checkCodeLimits(db, { ...base, at })).toEqual({ ok: true })
      await hitCodeLimits(db, { ...base, at })
    }
    const sixth = await checkCodeLimits(db, { ...base, at: secondsAfter(5 * 61) })
    expect(sixth).toMatchObject({ ok: false, reason: 'number_day' })
    // The claim itself refuses too, so a request that raced past the check is still stopped.
    await expect(hitCodeLimits(db, { ...base, at: secondsAfter(5 * 61) })).rejects.toMatchObject({ reason: 'number_day' })
  })

  it('keeps password-reset limits apart from sign-up ones, so a spammed number can still reset', async () => {
    const base = { phone: phoneN(1), userId: null, ip: '10.0.0.1' }
    for (let i = 0; i < 5; i++) await hitCodeLimits(db, { ...base, at: secondsAfter(i * 61) })
    const at = secondsAfter(5 * 61)
    expect(await checkCodeLimits(db, { ...base, at })).toMatchObject({ ok: false, reason: 'number_day' })
    expect(await checkCodeLimits(db, { ...base, at, purpose: 'reset' })).toEqual({ ok: true })
    await hitCodeLimits(db, { ...base, at, purpose: 'reset' })
    // The reset has its own minute.
    expect(await checkCodeLimits(db, { ...base, at: secondsAfter(5 * 61 + 5), purpose: 'reset' })).toMatchObject({ ok: false, reason: 'cooldown' })
  })

  it('stops a 6th distinct number for one account in a day, but not a number it already used', async () => {
    const stu = await makeUser(db, { role: 'student' })
    await claimCodes(db, [1, 2, 3, 4, 5].map(phoneN), stu.id)
    const fresh = await checkCodeLimits(db, { phone: phoneN(99), userId: stu.id, ip: null, at: secondsAfter(70) })
    expect(fresh).toMatchObject({ ok: false, reason: 'account_numbers' })
    expect((fresh as { retryAfter: number }).retryAfter).toBe(12 * 3600 - 70)
    await expect(hitCodeLimits(db, { phone: phoneN(99), userId: stu.id, ip: null, at: secondsAfter(70) })).rejects.toMatchObject({
      reason: 'account_numbers',
    })
    // One of its five numbers again (past its minute): fine.
    expect(await checkCodeLimits(db, { phone: phoneN(1), userId: stu.id, ip: null, at: secondsAfter(70) })).toEqual({ ok: true })
    // Another account is not affected, and neither is the same account the next day.
    const other = await makeUser(db, { role: 'student' })
    expect(await checkCodeLimits(db, { phone: phoneN(99), userId: other.id, ip: null, at: secondsAfter(70) })).toEqual({ ok: true })
    const nextDay = new Date(AT.getTime() + 24 * 3600 * 1000)
    expect(await checkCodeLimits(db, { phone: phoneN(99), userId: stu.id, ip: null, at: nextDay })).toEqual({ ok: true })
  })

  it('stops a 3rd distinct number in a day for an account that is not verified yet', async () => {
    const pending = await makeUser(db, { role: 'student', emailVerified: false, phoneNumberVerified: false })
    await claimCodes(db, [1, 2].map(phoneN), pending.id)
    const third = { phone: phoneN(3), userId: pending.id, ip: null, at: secondsAfter(70) }
    expect(await checkCodeLimits(db, third)).toMatchObject({ ok: false, reason: 'account_numbers' })
    await expect(hitCodeLimits(db, third)).rejects.toMatchObject({ reason: 'account_numbers' })
    // One of its two numbers again (past its minute): fine.
    expect(await checkCodeLimits(db, { ...third, phone: phoneN(1) })).toEqual({ ok: true })
    // Once verified (by email or WhatsApp), it gets the usual five.
    await db.update(user).set({ emailVerified: true }).where(eq(user.id, pending.id))
    expect(await checkCodeLimits(db, third)).toEqual({ ok: true })
    await hitCodeLimits(db, third)
  })

  it('lets only 2 of many parallel requests from an unverified account to different numbers through', async () => {
    const pending = await makeUser(db, { role: 'student', emailVerified: false, phoneNumberVerified: false })
    const results = await Promise.allSettled(
      Array.from({ length: 8 }, (_, i) => hitCodeLimits(db, { phone: phoneN(i + 1), userId: pending.id, ip: null, at: AT })),
    )
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(2)
  })

  it('lets only 5 of many parallel requests from one account to different numbers through', async () => {
    const stu = await makeUser(db, { role: 'student' })
    const results = await Promise.allSettled(
      Array.from({ length: 12 }, (_, i) => hitCodeLimits(db, { phone: phoneN(i + 1), userId: stu.id, ip: null, at: AT })),
    )
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(5)
    for (const r of results) {
      if (r.status === 'rejected') expect(r.reason).toMatchObject({ reason: 'account_numbers' })
    }
  })

  it('allows 60 codes an hour from one IP to different numbers and stops the 61st', async () => {
    for (let i = 1; i <= 60; i++) {
      const input = { phone: phoneN(i), userId: null, ip: '203.0.113.9', at: AT }
      expect(await checkCodeLimits(db, input)).toEqual({ ok: true })
      await hitCodeLimits(db, input)
    }
    const sixtyFirst = { phone: phoneN(61), userId: null, ip: '203.0.113.9', at: AT }
    expect(await checkCodeLimits(db, sixtyFirst)).toMatchObject({ ok: false, reason: 'ip' })
    // The claim refuses too: parallel requests that all passed the check cannot all get through.
    await expect(hitCodeLimits(db, sixtyFirst)).rejects.toMatchObject({ reason: 'ip' })
    // Another IP is not affected.
    expect(await checkCodeLimits(db, { ...sixtyFirst, ip: '203.0.113.10' })).toEqual({ ok: true })
  })

  it('stops the 101st verification code of the day for everyone, and lets codesAvailableToday say so', async () => {
    await db.insert(rateLimit).values({ key: 'otp:global:verify:2026-11-25', windowStart: AT, count: 99 })
    expect(await codesAvailableToday(db, secondsAfter(5))).toBe(true)
    const input = { phone: phoneN(500), userId: null, ip: null, at: secondsAfter(5) }
    expect(await checkCodeLimits(db, input)).toEqual({ ok: true })
    await hitCodeLimits(db, input)
    expect(await codesAvailableToday(db, secondsAfter(6))).toBe(false)
    const next = { ...input, phone: phoneN(501), at: secondsAfter(6) }
    expect(await checkCodeLimits(db, next)).toMatchObject({ ok: false, reason: 'global' })
    await expect(hitCodeLimits(db, next)).rejects.toMatchObject({ reason: 'global' })
    // A refused claim leaves nothing behind: the day's count stays at 100.
    const [counter] = await db.select().from(rateLimit).where(eq(rateLimit.key, 'otp:global:verify:2026-11-25'))
    expect(counter.count).toBe(100)
    // Yesterday's codes do not count today.
    expect(await codesAvailableToday(db, new Date(AT.getTime() + 24 * 3600 * 1000))).toBe(true)
  })

  it('keeps 50 password-reset codes a day apart, so used-up verification codes never hide "Forgot password"', async () => {
    await db.insert(rateLimit).values({ key: 'otp:global:verify:2026-11-25', windowStart: AT, count: 100 })
    expect(await codesAvailableToday(db, AT)).toBe(false)
    expect(await resetCodesAvailableToday(db, AT)).toBe(true)
    const reset = { phone: phoneN(700), userId: null, ip: null, purpose: 'reset' as const, at: AT }
    expect(await checkCodeLimits(db, reset)).toEqual({ ok: true })
    await hitCodeLimits(db, reset)

    await db.update(rateLimit).set({ count: 49 }).where(eq(rateLimit.key, 'otp:global:reset:2026-11-25'))
    await hitCodeLimits(db, { ...reset, phone: phoneN(701) })
    expect(await resetCodesAvailableToday(db, AT)).toBe(false)
    const fifty1st = { ...reset, phone: phoneN(702) }
    expect(await checkCodeLimits(db, fifty1st)).toMatchObject({ ok: false, reason: 'global' })
    await expect(hitCodeLimits(db, fifty1st)).rejects.toMatchObject({ reason: 'global' })
    // And the other way round: used-up reset codes leave verification alone.
    await db.update(rateLimit).set({ count: 0 }).where(eq(rateLimit.key, 'otp:global:verify:2026-11-25'))
    expect(await checkCodeLimits(db, { phone: phoneN(703), userId: null, ip: null, at: AT })).toEqual({ ok: true })
  })

  it('lets only the last free slot of the day go to one of many parallel requests', async () => {
    await db.insert(rateLimit).values({ key: 'otp:global:verify:2026-11-25', windowStart: AT, count: 95 })
    const results = await Promise.allSettled(
      Array.from({ length: 10 }, (_, i) => hitCodeLimits(db, { phone: phoneN(600 + i), userId: null, ip: null, at: AT })),
    )
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(5)
  })
})

describe('sendVerificationCode', () => {
  let db: Db
  beforeEach(async () => {
    db = await createTestDb()
  })

  it('sends the verification_code template in the given language and records one row', async () => {
    const sent = captureProvider()
    const stu = await makeUser(db, { role: 'student' })
    await db.insert(whatsappMonthUsage).values({ month: '2026-11', sent: 3 })
    await sendVerificationCode(db, { phone: phoneN(7), code: '482913', locale: 'fr', userId: stu.id, at: AT })
    expect(sent).toEqual([
      { to: phoneN(7), msg: { name: 'verification_code', language: 'fr', bodyParams: ['482913'], buttonPath: '482913' } },
    ])
    const rows = await db.select().from(whatsappMessage)
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({
      userId: stu.id,
      kind: 'verificationCode',
      eventKey: `otp:${phoneN(7)}:2026-11-25T12:00:00.000Z`,
      template: 'verification_code',
      status: 'sent',
      providerMessageId: 'wamid.1',
    })
    // A code is not an alert: the monthly usage is untouched.
    const [usage] = await db.select().from(whatsappMonthUsage)
    expect(usage.sent).toBe(3)
  })

  it('sends nothing to a number outside WHATSAPP_ALLOWLIST', async () => {
    const sent = captureProvider()
    vi.stubEnv('WHATSAPP_ALLOWLIST', phoneN(8))
    await sendVerificationCode(db, { phone: phoneN(7), code: '482913', locale: 'en', userId: null, at: AT })
    expect(sent).toEqual([])
    expect(await db.select().from(whatsappMessage)).toEqual([])
    await sendVerificationCode(db, { phone: phoneN(8), code: '482913', locale: 'en', userId: null, at: AT })
    expect(sent).toHaveLength(1)
  })

  it('records a failed send without throwing', async () => {
    captureProvider({ failWith: new Error('provider down') })
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {})
    await expect(sendVerificationCode(db, { phone: phoneN(7), code: '482913', locale: 'en', userId: null, at: AT })).resolves.toBeUndefined()
    errors.mockRestore()
    const [row] = await db.select().from(whatsappMessage)
    expect(row).toMatchObject({ kind: 'verificationCode', status: 'failed', error: 'provider down' })
  })
})

const BASE = 'http://localhost:3000'
const PASSWORD = 'correct-horse-9'

describe('auth: WhatsApp code routes', () => {
  const original = config.requireEmailVerification
  let db: Db
  let auth: ReturnType<typeof createAuth>
  let sent: Sent[]
  let cookie: string
  let userId: string
  let n = 0

  function post(path: string, body: unknown, options: { signedIn?: boolean; ip?: string; headers?: Record<string, string> } = {}) {
    n += 1
    return auth.handler(
      new Request(`${BASE}/api/auth${path}`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          origin: BASE,
          [CLIENT_IP_HEADER]: options.ip ?? `198.51.100.${n}`,
          ...(options.signedIn && cookie ? { cookie } : {}),
          ...options.headers,
        },
        body: JSON.stringify(body),
      }),
    )
  }

  beforeAll(async () => {
    setConfigForTests({ requireEmailVerification: false })
    db = await createTestDb()
    auth = createAuth(db, { baseURL: BASE, secret: 'test-secret-test-secret-test-secret-123', nextCookies: false })
    const res = await post('/sign-up/email', { name: 'Stu', email: 'stu@example.com', password: PASSWORD, role: 'student', locale: 'en' })
    expect(res.status).toBe(200)
    cookie = res.headers
      .getSetCookie()
      .map((c) => c.split(';')[0])
      .join('; ')
    userId = ((await res.json()) as { user: { id: string } }).user.id
    // Verified, so it may ask for codes to the usual five numbers a day (an unverified account gets two).
    await db.update(user).set({ emailVerified: true }).where(eq(user.id, userId))
    return () => setConfigForTests({ requireEmailVerification: original })
  })

  beforeEach(() => {
    sent = captureProvider()
    vi.stubEnv('WHATSAPP_AWS_REGION', 'eu-north-1')
    vi.stubEnv('WHATSAPP_AWS_ROLE_ARN', 'arn:aws:iam::1:role/x')
    vi.stubEnv('WHATSAPP_PHONE_NUMBER_ID', 'phone-number-id-1')
    vi.stubEnv('WHATSAPP_DISPLAY_NUMBER', '+15558903752')
    vi.stubEnv('WHATSAPP_SNS_TOPIC_ARN', 'arn:aws:sns:eu-north-1:1:topic')
    vi.stubEnv('WHATSAPP_OTP_ENABLED', 'true')
  })

  // The plugin runs the send in the background: give a send that should not happen time to show itself.
  const settle = () => new Promise((resolve) => setTimeout(resolve, 50))

  it('does not exist while WhatsApp codes are off', async () => {
    vi.stubEnv('WHATSAPP_OTP_ENABLED', 'false')
    const send = await post('/phone-number/send-otp', { phoneNumber: '+237677000001' }, { signedIn: true })
    expect(send.status).toBe(404)
    const reset = await post('/phone-number/request-password-reset', { phoneNumber: '+237677000001' })
    expect(reset.status).toBe(404)
    await settle()
    expect(sent).toEqual([])
  })

  it('never lets an anonymous visitor make Clasync send a message', async () => {
    const res = await post('/phone-number/send-otp', { phoneNumber: '+237677000002' })
    expect(res.status).toBe(401)
    await settle()
    expect(sent).toEqual([])
    expect(await db.select().from(whatsappMessage)).toEqual([])
  })

  it('refuses a number that cannot be put into E.164 form, before anything is counted or sent', async () => {
    const res = await post('/phone-number/send-otp', { phoneNumber: '12ab' }, { signedIn: true })
    expect(res.status).toBe(400)
    expect(((await res.json()) as { code?: string }).code).toBe('INVALID_PHONE_NUMBER')
    await settle()
    expect(sent).toEqual([])
  })

  it('sends a code to a signed-in account once a minute, normalising the number it was given', async () => {
    const first = await post('/phone-number/send-otp', { phoneNumber: '677 00 00 03' }, { signedIn: true })
    expect(first.status).toBe(200)
    await vi.waitFor(() => expect(sent).toHaveLength(1))
    expect(sent[0].to).toBe('+237677000003')
    expect(sent[0].msg).toMatchObject({ name: 'verification_code', language: 'en', bodyParams: [expect.stringMatching(/^\d{6}$/)] })
    await vi.waitFor(async () => {
      const [row] = await db.select().from(whatsappMessage).where(eq(whatsappMessage.userId, userId))
      expect(row).toMatchObject({ kind: 'verificationCode', status: 'sent' })
    })

    const again = await post('/phone-number/send-otp', { phoneNumber: '+237677000003' }, { signedIn: true })
    expect(again.status).toBe(429)
    const body = (await again.json()) as { code?: string; retryAfter?: number }
    expect(body.code).toBe('PHONE_CODE_LIMITED')
    expect(body.retryAfter).toBeGreaterThan(0)
    expect(body.retryAfter).toBeLessThanOrEqual(60)
    expect(again.headers.get('retry-after')).toBe(String(body.retryAfter))
    await settle()
    expect(sent).toHaveLength(1)
  })

  it('does not let an anonymous sign-in replace or reveal a code pending verification', async () => {
    const phone = '+237677000004'
    await db.update(user).set({ phoneNumber: phone, phoneNumberVerified: false }).where(eq(user.id, userId))
    const asked = await post('/phone-number/send-otp', { phoneNumber: phone }, { signedIn: true })
    expect(asked.status).toBe(200)
    await vi.waitFor(() => expect(sent).toHaveLength(1))
    const identifier = `phone-number-otp-${phone}`
    const before = await db.select().from(verification).where(eq(verification.identifier, identifier))
    expect(before).toHaveLength(1)

    // Anyone who knows the number can try: the answer is the generic wrong-password one, and nothing is stored or sent.
    const res = await post('/sign-in/phone-number', { phoneNumber: phone, password: 'not-the-password-1' })
    expect(res.status).toBe(401)
    expect(((await res.json()) as { code?: string }).code).toBe('INVALID_PHONE_NUMBER_OR_PASSWORD')
    await settle()
    const after = await db.select().from(verification).where(eq(verification.identifier, identifier))
    expect(after.map((r) => r.value)).toEqual(before.map((r) => r.value))
    expect(sent).toHaveLength(1)
    await db.update(user).set({ phoneNumber: null }).where(eq(user.id, userId))
  })

  it('refuses a number another account has already proven, before counting or sending anything', async () => {
    const holder = await makeUser(db, { role: 'student' })
    const phone = '+237677000008'
    await db.update(user).set({ phoneNumber: phone, phoneNumberVerified: true }).where(eq(user.id, holder.id))
    const res = await post('/phone-number/send-otp', { phoneNumber: phone }, { signedIn: true })
    expect(res.status).toBe(400)
    expect(((await res.json()) as { code?: string }).code).toBe('NUMBER_TAKEN')
    await settle()
    expect(sent).toEqual([])
    expect(await db.select().from(rateLimit).where(like(rateLimit.key, `%${phone}%`))).toEqual([])
  })

  it('answers a password-reset request the same for every number, and sends only for a verified holder', async () => {
    const holder = await makeUser(db, { role: 'student', locale: 'fr' })
    const phone = '+237677000005'
    await db.update(user).set({ phoneNumber: phone, phoneNumberVerified: true }).where(eq(user.id, holder.id))

    const unknown = await post('/phone-number/request-password-reset', { phoneNumber: '+237677000006' })
    expect(unknown.status).toBe(200)
    expect(await unknown.json()).toEqual({ status: true })
    await settle()
    expect(sent).toEqual([])

    const known = await post('/phone-number/request-password-reset', { phoneNumber: phone })
    expect(known.status).toBe(200)
    expect(await known.json()).toEqual({ status: true })
    await vi.waitFor(() => expect(sent).toHaveLength(1))
    // The language of the account that holds the number, not the visitor's.
    expect(sent[0]).toMatchObject({ to: phone, msg: { name: 'verification_code', language: 'fr' } })

    // A second request inside the minute looks identical but sends nothing.
    const limited = await post('/phone-number/request-password-reset', { phoneNumber: phone })
    expect(limited.status).toBe(200)
    expect(await limited.json()).toEqual({ status: true })
    await settle()
    expect(sent).toHaveLength(1)
  })

  const globalClaims = async () =>
    (await db.select().from(rateLimit).where(like(rateLimit.key, 'otp:global:%'))).reduce((sum, r) => sum + r.count, 0)

  it('does not spend the daily budget on resets that cannot send a message', async () => {
    const before = await globalClaims()
    for (let i = 0; i < 250; i++) {
      // Five IPs, 50 requests each: under the per-IP limit, so every one reaches the guard.
      const res = await post('/phone-number/request-password-reset', { phoneNumber: `+2376771${String(i).padStart(5, '0')}` }, { ip: `10.9.0.${Math.floor(i / 50)}` })
      expect(res.status).toBe(200)
      expect(await res.json()).toEqual({ status: true })
    }
    await settle()
    expect(sent).toEqual([])
    expect(await globalClaims()).toBe(before)
    expect(await codesAvailableToday(db)).toBe(true)
    expect(await resetCodesAvailableToday(db)).toBe(true)
    // They were still counted against their IPs.
    const [ipRow] = await db.select().from(rateLimit).where(eq(rateLimit.key, 'otp:ip:10.9.0.0'))
    expect(ipRow.count).toBe(50)
  }, 30_000)

  it('spends one unit of the daily budget on a reset for a verified holder', async () => {
    const holder = await makeUser(db, { role: 'student' })
    const phone = '+237677000009'
    await db.update(user).set({ phoneNumber: phone, phoneNumberVerified: true }).where(eq(user.id, holder.id))
    const before = await globalClaims()
    const res = await post('/phone-number/request-password-reset', { phoneNumber: phone })
    expect(res.status).toBe(200)
    await vi.waitFor(() => expect(sent).toHaveLength(1))
    expect(await globalClaims()).toBe(before + 1)
  })

  it('spends nothing on numbers outside WHATSAPP_ALLOWLIST: a reset answers as usual, a sign-up request is refused', async () => {
    vi.stubEnv('WHATSAPP_ALLOWLIST', '+237677999999')
    const holder = await makeUser(db, { role: 'student' })
    const phone = '+237677000010'
    await db.update(user).set({ phoneNumber: phone, phoneNumberVerified: true }).where(eq(user.id, holder.id))
    const before = await globalClaims()
    const reset = await post('/phone-number/request-password-reset', { phoneNumber: phone })
    expect(reset.status).toBe(200)
    expect(await reset.json()).toEqual({ status: true })
    const send = await post('/phone-number/send-otp', { phoneNumber: '+237677000011' }, { signedIn: true })
    expect(send.status).toBe(400)
    expect(((await send.json()) as { code?: string }).code).toBe('NUMBER_NOT_ALLOWED')
    await settle()
    expect(sent).toEqual([])
    expect(await globalClaims()).toBe(before)
    expect(await db.select().from(rateLimit).where(like(rateLimit.key, '%+237677000011%'))).toEqual([])
  })

  it("writes a code the signed-in account asked for in that account's language, not the cookie's", async () => {
    await db.update(user).set({ locale: 'fr' }).where(eq(user.id, userId))
    const res = await post(
      '/phone-number/send-otp',
      { phoneNumber: '+237677000007' },
      { signedIn: true, headers: { cookie: `${cookie}; NEXT_LOCALE=en` } },
    )
    expect(res.status).toBe(200)
    await vi.waitFor(() => expect(sent).toHaveLength(1))
    expect(sent[0].msg.language).toBe('fr')
    await db.update(user).set({ locale: 'en' }).where(eq(user.id, userId))
  })
})
