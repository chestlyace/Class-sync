import { eq } from 'drizzle-orm'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { CLIENT_IP_HEADER } from '@/lib/client-ip'
import { config, setConfigForTests } from '@/server/core/config'
import type { Db } from '@/server/db'
import { user, verification, whatsappMessage } from '@/server/db/schema'
import { setWhatsAppProviderForTests, type TemplateMessage } from '@/server/whatsapp/provider'
import { createTestDb } from '@/test/db'
import { createAuth } from './auth'

const BASE = 'http://localhost:3000'
const PASSWORD = 'correct-horse-9'
const PROVEN = '+237677000101'
const UNPROVEN = '+237677000102'

describe('auth: sign in with a WhatsApp number', () => {
  const original = config.requireEmailVerification
  let db: Db
  let auth: ReturnType<typeof createAuth>
  let sent: { to: string; msg: TemplateMessage }[]
  let provenId: string
  let unprovenId: string
  let n = 0

  // A different client address each time, so the sign-in rate limit never gets in the way.
  function signIn(phoneNumber: string, password: string) {
    n += 1
    return auth.handler(
      new Request(`${BASE}/api/auth/sign-in/phone-number`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', origin: BASE, [CLIENT_IP_HEADER]: `203.0.113.${n}` },
        body: JSON.stringify({ phoneNumber, password }),
      }),
    )
  }

  async function signUp(email: string): Promise<string> {
    n += 1
    const res = await auth.handler(
      new Request(`${BASE}/api/auth/sign-up/email`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', origin: BASE, [CLIENT_IP_HEADER]: `203.0.113.${n}` },
        body: JSON.stringify({ name: 'Stu', email, password: PASSWORD, role: 'student', locale: 'en' }),
      }),
    )
    expect(res.status).toBe(200)
    return ((await res.json()) as { user: { id: string } }).user.id
  }

  beforeAll(async () => {
    setConfigForTests({ requireEmailVerification: false })
    db = await createTestDb()
    auth = createAuth(db, { baseURL: BASE, secret: 'test-secret-test-secret-test-secret-123', nextCookies: false })
    provenId = await signUp('proven@example.com')
    unprovenId = await signUp('unproven@example.com')
    await db.update(user).set({ phoneNumber: PROVEN, phoneNumberVerified: true }).where(eq(user.id, provenId))
    await db.update(user).set({ phoneNumber: UNPROVEN, phoneNumberVerified: false }).where(eq(user.id, unprovenId))
    return () => setConfigForTests({ requireEmailVerification: original })
  })

  beforeEach(() => {
    sent = []
    setWhatsAppProviderForTests({
      async sendTemplate(to, msg) {
        sent.push({ to, msg })
        return { messageId: `wamid.${sent.length}` }
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

  // The plugin would send in the background: give a send that should not happen time to show itself.
  const settle = () => new Promise((resolve) => setTimeout(resolve, 50))

  it('signs in a number an account has proven, with the right password', async () => {
    const res = await signIn(PROVEN, PASSWORD)
    expect(res.status).toBe(200)
    expect(((await res.json()) as { user: { id: string } }).user.id).toBe(provenId)
    expect(res.headers.getSetCookie().join(';')).toContain('session_token')
  })

  it('signs the same account in when the number is typed in local form', async () => {
    for (const typed of ['677000101', '677 00 01 01', '00237677000101']) {
      const res = await signIn(typed, PASSWORD)
      expect(res.status, typed).toBe(200)
      expect(((await res.json()) as { user: { id: string } }).user.id, typed).toBe(provenId)
    }
  })

  it('keeps working when WhatsApp codes are switched off: the number was already proven', async () => {
    vi.stubEnv('WHATSAPP_OTP_ENABLED', 'false')
    const res = await signIn(PROVEN, PASSWORD)
    expect(res.status).toBe(200)
  })

  it('answers a wrong password with the generic code', async () => {
    const res = await signIn(PROVEN, 'not-the-password-1')
    expect(res.status).toBe(401)
    expect(((await res.json()) as { code?: string }).code).toBe('INVALID_PHONE_NUMBER_OR_PASSWORD')
  })

  it('answers an unproven number exactly like a wrong password, even with the right one, and sends nothing', async () => {
    const wrong = await signIn(PROVEN, 'not-the-password-1')
    const unproven = await signIn(UNPROVEN, PASSWORD)
    const localForm = await signIn('677000102', PASSWORD)
    for (const res of [unproven, localForm]) {
      expect(res.status).toBe(wrong.status)
      expect(res.headers.getSetCookie()).toEqual([])
    }
    // The wrong-password answer comes from the plugin itself: the guard's answer carries the same code and message.
    const wrongBody = (await wrong.json()) as { code?: string; message?: string }
    expect(wrongBody.code).toBe('INVALID_PHONE_NUMBER_OR_PASSWORD')
    for (const res of [unproven, localForm]) {
      const body = (await res.json()) as { code?: string; message?: string }
      expect(body.code).toBe(wrongBody.code)
      expect(body.message).toBe(wrongBody.message)
    }
    await settle()
    expect(sent).toEqual([])
    expect(await db.select().from(whatsappMessage)).toEqual([])
    // And no code was stored for the number's owner to be locked out of.
    expect(await db.select().from(verification).where(eq(verification.identifier, `phone-number-otp-${UNPROVEN}`))).toEqual([])
  })

  it('answers a number nobody has the same way', async () => {
    const res = await signIn('+237677000199', PASSWORD)
    expect(res.status).toBe(401)
    expect(((await res.json()) as { code?: string }).code).toBe('INVALID_PHONE_NUMBER_OR_PASSWORD')
  })
})
