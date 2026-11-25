import type { ReactElement } from 'react'
import { render } from '@react-email/render'
import { eq } from 'drizzle-orm'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { CLIENT_IP_HEADER } from '@/lib/client-ip'
import { config, setConfigForTests } from '@/server/core/config'
import type { Db } from '@/server/db'
import { session, user, verification, whatsappMessage } from '@/server/db/schema'
import { emailSubject } from '@/server/email/templates/verify-email'
import { setWhatsAppProviderForTests } from '@/server/whatsapp/provider'
import { createTestDb } from '@/test/db'
import { createAuth } from './auth'
import { resetPasswordByWhatsAppAndSignIn } from './reset-password-phone'

const sent = vi.hoisted(() => [] as { to: string; subject: string; kind: string; react: ReactElement }[])
const sendFailure = vi.hoisted(() => ({ next: false }))
vi.mock('@/server/email/send', () => ({
  sendEmail: vi.fn(async (args: { to: string; subject: string; kind: string; react: ReactElement }) => {
    if (sendFailure.next) {
      sendFailure.next = false
      throw new Error('Resend is down')
    }
    sent.push(args)
  }),
}))

const BASE = 'http://localhost:3000'
const OLD_PASSWORD = 'correct-horse-9'
const NEW_PASSWORD = 'a-brand-new-pass-7'
const headers = () => new Headers({ origin: BASE })

describe('resetPasswordByWhatsAppAndSignIn', () => {
  const original = config.requireEmailVerification
  let db: Db
  let auth: ReturnType<typeof createAuth>
  let codes: string[]
  let messages: number
  let n = 0

  beforeAll(async () => {
    // As in production: no session at sign-up, so the sessions below are exactly the ones a test creates.
    setConfigForTests({ requireEmailVerification: true })
    db = await createTestDb()
    auth = createAuth(db, { baseURL: BASE, secret: 'test-secret-test-secret-test-secret-123', nextCookies: false })
  })
  afterAll(() => setConfigForTests({ requireEmailVerification: original }))

  beforeEach(() => {
    sent.length = 0
    sendFailure.next = false
    codes = []
    messages = 0
    vi.stubEnv('WHATSAPP_AWS_REGION', 'eu-north-1')
    vi.stubEnv('WHATSAPP_AWS_ROLE_ARN', 'arn:aws:iam::1:role/x')
    vi.stubEnv('WHATSAPP_PHONE_NUMBER_ID', 'phone-number-id-1')
    vi.stubEnv('WHATSAPP_DISPLAY_NUMBER', '+15558903752')
    vi.stubEnv('WHATSAPP_SNS_TOPIC_ARN', 'arn:aws:sns:eu-north-1:1:topic')
    vi.stubEnv('WHATSAPP_OTP_ENABLED', 'true')
    setWhatsAppProviderForTests({
      async sendTemplate(_to, msg) {
        messages += 1
        codes.push(msg.bodyParams[0]!)
        return { messageId: `wamid.${messages}` }
      },
      async sendText() {
        return { messageId: 'text' }
      },
    })
  })
  afterEach(() => {
    setWhatsAppProviderForTests(null)
    vi.unstubAllEnvs()
  })

  // The plugin sends in the background: give a send that should not happen time to show itself.
  const settle = () => new Promise((resolve) => setTimeout(resolve, 60))

  /** An account with a number, made the way production makes one. `phone` ends in 47 unless given. */
  async function account(opts: { emailVerified?: boolean; phoneVerified?: boolean; phone?: string } = {}) {
    n += 1
    const email = `reset-wa-${n}@example.com`
    const phone = opts.phone ?? `+23767700${String(n).padStart(2, '0')}47`
    const { user: created } = await auth.api.signUpEmail({ body: { name: 'Ama', email, password: OLD_PASSWORD, role: 'student', locale: 'en' } as never })
    await db
      .update(user)
      .set({ phoneNumber: phone, phoneNumberVerified: opts.phoneVerified ?? true, emailVerified: opts.emailVerified ?? false })
      .where(eq(user.id, created.id))
    return { id: created.id, email, phone }
  }

  /** Asks for a code the way the page does (over HTTP, so the guard runs); returns the answer. */
  async function requestCode(phoneNumber: string): Promise<{ status: number; body: unknown }> {
    n += 1
    const res = await auth.handler(
      new Request(`${BASE}/api/auth/phone-number/request-password-reset`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', origin: BASE, [CLIENT_IP_HEADER]: `198.51.100.${n % 250}` },
        body: JSON.stringify({ phoneNumber }),
      }),
    )
    return { status: res.status, body: await res.json() }
  }

  async function issuedCode(phone: string): Promise<string> {
    expect(await requestCode(phone)).toEqual({ status: 200, body: { status: true } })
    for (let i = 0; i < 100 && codes.length === 0; i++) await new Promise((r) => setTimeout(r, 20))
    expect(codes).toHaveLength(1)
    return codes[0]!
  }

  const wrongCodeFor = (code: string) => (code === '000000' ? '111111' : '000000')

  async function sessionsOf(userId: string) {
    return db.select().from(session).where(eq(session.userId, userId))
  }
  async function canSignIn(email: string, password: string): Promise<boolean> {
    try {
      await auth.api.signInEmail({ body: { email, password } })
      return true
    } catch {
      return false
    }
  }

  it('changes the password, ends the older sessions, signs this browser in and leaves the email unverified', async () => {
    const { id, email, phone } = await account()
    await auth.api.signInEmail({ body: { email, password: OLD_PASSWORD } })
    await auth.api.signInEmail({ body: { email, password: OLD_PASSWORD } })
    const older = (await sessionsOf(id)).map((s) => s.id)
    expect(older).toHaveLength(2)
    const code = await issuedCode(phone)

    const outcome = await resetPasswordByWhatsAppAndSignIn(auth, { phone, code, newPassword: NEW_PASSWORD, headers: headers() })
    expect(outcome).toEqual({ status: 'signed-in' })

    const now = await sessionsOf(id)
    expect(now).toHaveLength(1)
    expect(older).not.toContain(now[0]!.id)
    const [row] = await db.select().from(user).where(eq(user.id, id))
    expect(row.emailVerified).toBe(false)
    expect(row.phoneNumberVerified).toBe(true)
    // An unverified address may belong to someone else: it gets no notice.
    expect(sent).toEqual([])
    expect(await canSignIn(email, NEW_PASSWORD)).toBe(true)
    expect(await canSignIn(email, OLD_PASSWORD)).toBe(false)
  })

  it('takes the number and the code the way people type them', async () => {
    const { id, phone } = await account({ phone: '+237677088847' })
    const code = await issuedCode(phone)
    const outcome = await resetPasswordByWhatsAppAndSignIn(auth, {
      phone: '677 08 88 47',
      code: ` ${code.slice(0, 3)} ${code.slice(3)} `,
      newPassword: NEW_PASSWORD,
      headers: headers(),
    })
    expect(outcome).toEqual({ status: 'signed-in' })
    expect(await sessionsOf(id)).toHaveLength(1)
  })

  it('tells a verified email, in the account language, with the last two digits, a way back and support', async () => {
    const { email, phone } = await account({ emailVerified: true })
    await db.update(user).set({ locale: 'fr' }).where(eq(user.email, email))
    const code = await issuedCode(phone)

    expect(await resetPasswordByWhatsAppAndSignIn(auth, { phone, code, newPassword: NEW_PASSWORD, headers: headers() })).toEqual({ status: 'signed-in' })

    expect(sent).toHaveLength(1)
    const notice = sent[0]!
    expect(notice.to).toBe(email)
    expect(notice.kind).toBe('passwordChangedWhatsApp')
    expect(notice.subject).toBe(emailSubject('passwordChangedWhatsApp', 'fr'))
    const text = await render(notice.react, { plainText: true })
    expect(text).toContain('47')
    expect(text).not.toContain(phone)
    expect(text).toContain(`${BASE}/forgot-password`)
    expect(text).toContain('support@clasync.online')
    // The email is verified, and stays so.
    const [row] = await db.select().from(user).where(eq(user.email, email))
    expect(row.emailVerified).toBe(true)
  })

  it('still resets the password when the notice cannot be sent', async () => {
    const { id, email, phone } = await account({ emailVerified: true })
    const code = await issuedCode(phone)
    sendFailure.next = true
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    try {
      expect(await resetPasswordByWhatsAppAndSignIn(auth, { phone, code, newPassword: NEW_PASSWORD, headers: headers() })).toEqual({ status: 'signed-in' })
      expect(error).toHaveBeenCalledWith('[auth] password changed notice failed', expect.any(Error))
    } finally {
      error.mockRestore()
    }
    expect(await sessionsOf(id)).toHaveLength(1)
    expect(await canSignIn(email, NEW_PASSWORD)).toBe(true)
  })

  it('changes nothing for a wrong code, and a right code still works afterwards', async () => {
    const { id, email, phone } = await account()
    const code = await issuedCode(phone)

    const outcome = await resetPasswordByWhatsAppAndSignIn(auth, { phone, code: wrongCodeFor(code), newPassword: NEW_PASSWORD, headers: headers() })
    expect(outcome).toEqual({ status: 'error', code: 'INVALID_OTP', httpStatus: 400 })
    expect(await canSignIn(email, OLD_PASSWORD)).toBe(true)
    expect(await canSignIn(email, NEW_PASSWORD)).toBe(false)
    expect(await sessionsOf(id)).toHaveLength(1)
    expect(sent).toEqual([])

    expect(await resetPasswordByWhatsAppAndSignIn(auth, { phone, code, newPassword: NEW_PASSWORD, headers: headers() })).toEqual({ status: 'signed-in' })
  })

  it('answers a code that is malformed, spent on wrong tries or never sent with the same "wrong code"', async () => {
    const { email, phone } = await account()
    const code = await issuedCode(phone)
    const wrong = wrongCodeFor(code)
    const expected = { status: 'error', code: 'INVALID_OTP', httpStatus: 400 }

    for (const attempt of ['12', 'abcdef', wrong, wrong, wrong, wrong]) {
      expect(await resetPasswordByWhatsAppAndSignIn(auth, { phone, code: attempt, newPassword: NEW_PASSWORD, headers: headers() })).toEqual(expected)
    }
    // Three wrong tries spent the code: even the right one no longer works, whatever the page is told.
    expect(await resetPasswordByWhatsAppAndSignIn(auth, { phone, code, newPassword: NEW_PASSWORD, headers: headers() })).toEqual(expected)
    expect(await canSignIn(email, OLD_PASSWORD)).toBe(true)
  })

  it('answers a number no account has proven exactly like a wrong code, and sends nothing', async () => {
    const stranger = '+237677009901'
    const unproven = await account({ phoneVerified: false })

    expect(await requestCode(stranger)).toEqual({ status: 200, body: { status: true } })
    expect(await requestCode(unproven.phone)).toEqual({ status: 200, body: { status: true } })
    await settle()
    expect(messages).toBe(0)
    expect(await db.select().from(whatsappMessage)).toEqual([])
    expect(await db.select().from(verification).where(eq(verification.identifier, `phone-number-otp-${stranger}`))).toEqual([])

    const known = await account()
    const real = await issuedCode(known.phone)
    const forKnown = await resetPasswordByWhatsAppAndSignIn(auth, { phone: known.phone, code: wrongCodeFor(real), newPassword: NEW_PASSWORD, headers: headers() })
    for (const phone of [stranger, unproven.phone]) {
      expect(await resetPasswordByWhatsAppAndSignIn(auth, { phone, code: '123456', newPassword: NEW_PASSWORD, headers: headers() })).toEqual(forKnown)
    }
    expect(await canSignIn(unproven.email, OLD_PASSWORD)).toBe(true)
  })

  it('reports a password that is too short without spending the code', async () => {
    const { phone } = await account()
    const code = await issuedCode(phone)
    const outcome = await resetPasswordByWhatsAppAndSignIn(auth, { phone, code, newPassword: 'short', headers: headers() })
    expect(outcome).toMatchObject({ status: 'error', code: 'PASSWORD_TOO_SHORT' })
    expect(await resetPasswordByWhatsAppAndSignIn(auth, { phone, code, newPassword: NEW_PASSWORD, headers: headers() })).toEqual({ status: 'signed-in' })
  })

  it('still changes the password when signing in is refused, and says so', async () => {
    const { id, email, phone } = await account()
    const code = await issuedCode(phone)
    await db.update(user).set({ suspendedAt: new Date() }).where(eq(user.id, id))
    expect(await resetPasswordByWhatsAppAndSignIn(auth, { phone, code, newPassword: NEW_PASSWORD, headers: headers() })).toEqual({ status: 'reset' })
    expect(await sessionsOf(id)).toHaveLength(0)
    await db.update(user).set({ suspendedAt: null }).where(eq(user.id, id))
    expect(await canSignIn(email, NEW_PASSWORD)).toBe(true)
  })

  it('treats a call straight to the plugin route as a WhatsApp reset too: email stays unverified, a verified email is told', async () => {
    const plain = await account()
    const verified = await account({ emailVerified: true })
    for (const who of [plain, verified]) {
      codes = []
      const code = await issuedCode(who.phone)
      const res = await auth.handler(
        new Request(`${BASE}/api/auth/phone-number/reset-password`, {
          method: 'POST',
          headers: { 'content-type': 'application/json', origin: BASE },
          body: JSON.stringify({ phoneNumber: who.phone, otp: code, newPassword: NEW_PASSWORD }),
        }),
      )
      expect(res.status).toBe(200)
    }
    const [plainRow] = await db.select().from(user).where(eq(user.id, plain.id))
    expect(plainRow.emailVerified).toBe(false)
    expect(sent.map((s) => s.to)).toEqual([verified.email])
  })
})
