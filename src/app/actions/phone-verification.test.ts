import { eq } from 'drizzle-orm'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { config, setConfigForTests } from '@/server/core/config'
// eslint-disable-next-line no-restricted-imports -- a test reads the rows the action wrote
import { user, whatsappLink, whatsappPreference } from '@/server/db/schema'
import { setWhatsAppProviderForTests } from '@/server/whatsapp/provider'
import { authRequest, cookiesOf, TEST_ORIGIN } from '@/test/mcp-oauth'

// One in-memory database and one Better Auth on it, standing in for the app's own.
vi.mock('@/server/db', async () => {
  const { createTestDb } = await import('@/test/db')
  return { db: await createTestDb() }
})
vi.mock('@/server/auth/auth', async () => {
  const { db } = await import('@/server/db')
  const actual = await vi.importActual<typeof import('@/server/auth/auth')>('@/server/auth/auth')
  return {
    ...actual,
    auth: actual.createAuth(db, { baseURL: 'http://localhost:3000', secret: 'test-secret-test-secret-test-secret-123', nextCookies: false }),
  }
})
const requestHeaders = vi.hoisted(() => ({ current: new Headers() }))
vi.mock('next/headers', () => ({ headers: async () => requestHeaders.current }))

import { auth } from '@/server/auth/auth'
// eslint-disable-next-line no-restricted-imports -- the in-memory database mocked above
import { db } from '@/server/db'
import { verifyWhatsAppCode } from './phone-verification'

const PASSWORD = 'correct-horse-9'
let counter = 0

function enableCodes() {
  vi.stubEnv('WHATSAPP_AWS_REGION', 'eu-north-1')
  vi.stubEnv('WHATSAPP_AWS_ROLE_ARN', 'arn:aws:iam::1:role/x')
  vi.stubEnv('WHATSAPP_PHONE_NUMBER_ID', 'phone-number-id-1')
  vi.stubEnv('WHATSAPP_DISPLAY_NUMBER', '+15558903752')
  vi.stubEnv('WHATSAPP_SNS_TOPIC_ARN', 'arn:aws:sns:eu-north-1:1:topic')
  vi.stubEnv('WHATSAPP_OTP_ENABLED', 'true')
}

/** A fresh number each test, so one test's limits never reach another. */
const newPhone = () => `+2376${String(++counter).padStart(8, '0')}`

/** Signs a new unverified account up and in, and makes the next action call carry its session. */
async function signedInUser() {
  const email = `wa-${++counter}-${crypto.randomUUID().slice(0, 6)}@example.com`
  const up = await auth.handler(
    authRequest('/api/auth/sign-up/email', { body: { name: 'Ama', email, password: PASSWORD, role: 'student', locale: 'en' } }),
  )
  expect(up.status).toBe(200)
  const inRes = await auth.handler(authRequest('/api/auth/sign-in/email', { body: { email, password: PASSWORD } }))
  const cookie = cookiesOf(inRes)
  expect(cookie).toContain('session_token')
  requestHeaders.current = new Headers({ cookie, origin: TEST_ORIGIN })
  const [row] = await db.select().from(user).where(eq(user.email, email))
  return { id: row.id, cookie }
}

/** Asks for a code the way the page does, and reads it off the message the provider was given. */
async function requestCode(phone: string, cookie: string): Promise<string> {
  const sent: string[] = []
  setWhatsAppProviderForTests({
    async sendTemplate(_to, msg) {
      sent.push(msg.bodyParams[0]!)
      return { messageId: `wamid.${sent.length}` }
    },
    async sendText() {
      return { messageId: 'text' }
    },
  })
  const res = await auth.handler(authRequest('/api/auth/phone-number/send-otp', { body: { phoneNumber: phone }, cookie }))
  expect(res.status).toBe(200)
  for (let i = 0; i < 100 && sent.length === 0; i++) await new Promise((r) => setTimeout(r, 20))
  expect(sent).toHaveLength(1)
  return sent[0]!
}

const wrongCodeFor = (code: string) => (code === '000000' ? '111111' : '000000')

describe('verifyWhatsAppCode', () => {
  const originalVerification = config.requireEmailVerification

  beforeAll(() => {
    setConfigForTests({ requireEmailVerification: true })
    return () => setConfigForTests({ requireEmailVerification: originalVerification })
  })
  afterEach(() => {
    setWhatsAppProviderForTests(null)
    vi.unstubAllEnvs()
    requestHeaders.current = new Headers()
  })

  it('verifies the account with the number, and links it for alerts when asked', async () => {
    enableCodes()
    const phone = newPhone()
    const { id, cookie } = await signedInUser()
    const code = await requestCode(phone, cookie)

    expect(await verifyWhatsAppCode({ phone, code, alerts: true })).toEqual({ status: 'verified' })

    const [row] = await db.select().from(user).where(eq(user.id, id))
    expect(row.phoneNumber).toBe(phone)
    expect(row.phoneNumberVerified).toBe(true)
    expect(await db.select().from(whatsappLink).where(eq(whatsappLink.userId, id))).toEqual([
      expect.objectContaining({ userId: id, phone }),
    ])
    expect(await db.select().from(whatsappPreference).where(eq(whatsappPreference.userId, id))).toEqual([
      expect.objectContaining({ checkin: true, tests: true, results: true, assignments: true, classSoon: true }),
    ])
  })

  it('verifies without linking alerts when the person did not ask for them', async () => {
    enableCodes()
    const phone = newPhone()
    const { id, cookie } = await signedInUser()
    const code = await requestCode(phone, cookie)

    expect(await verifyWhatsAppCode({ phone: phone.replace('+237', ''), code: ` ${code.slice(0, 3)} ${code.slice(3)} `, alerts: false })).toEqual({
      status: 'verified',
    })

    const [row] = await db.select().from(user).where(eq(user.id, id))
    expect(row.phoneNumberVerified).toBe(true)
    expect(await db.select().from(whatsappLink).where(eq(whatsappLink.userId, id))).toEqual([])
    expect(await db.select().from(whatsappPreference).where(eq(whatsappPreference.userId, id))).toEqual([])
  })

  it('keeps an existing alert link when the number is verified again with alerts on', async () => {
    enableCodes()
    const phone = newPhone()
    const { id, cookie } = await signedInUser()
    await db.insert(whatsappLink).values({ userId: id, phone: newPhone() })
    const code = await requestCode(phone, cookie)

    expect(await verifyWhatsAppCode({ phone, code, alerts: true })).toEqual({ status: 'verified' })
    const links = await db.select().from(whatsappLink).where(eq(whatsappLink.userId, id))
    expect(links).toHaveLength(1)
    expect(links[0]!.phone).not.toBe(phone)
  })

  it('answers INVALID_OTP for a wrong code and sets nothing', async () => {
    enableCodes()
    const phone = newPhone()
    const { id, cookie } = await signedInUser()
    const code = await requestCode(phone, cookie)

    expect(await verifyWhatsAppCode({ phone, code: wrongCodeFor(code), alerts: true })).toEqual({ status: 'error', code: 'INVALID_OTP' })

    const [row] = await db.select().from(user).where(eq(user.id, id))
    expect(row.phoneNumber).toBeNull()
    expect(row.phoneNumberVerified).toBe(false)
    expect(await db.select().from(whatsappLink).where(eq(whatsappLink.userId, id))).toEqual([])
    // The right code still works afterwards.
    expect(await verifyWhatsAppCode({ phone, code, alerts: false })).toEqual({ status: 'verified' })
  })

  it('refuses a code that is not six digits without spending the real one', async () => {
    enableCodes()
    const phone = newPhone()
    const { cookie } = await signedInUser()
    const code = await requestCode(phone, cookie)

    expect(await verifyWhatsAppCode({ phone, code: '12ab', alerts: false })).toEqual({ status: 'error', code: 'INVALID_OTP' })
    expect(await verifyWhatsAppCode({ phone: 'not a number', code, alerts: false })).toEqual({ status: 'error', code: 'INVALID_OTP' })
    expect(await verifyWhatsAppCode({ phone, code, alerts: false })).toEqual({ status: 'verified' })
  })

  it('stops after too many wrong codes', async () => {
    enableCodes()
    const phone = newPhone()
    const { cookie } = await signedInUser()
    const code = await requestCode(phone, cookie)
    const wrong = wrongCodeFor(code)

    for (let i = 0; i < 3; i++) expect(await verifyWhatsAppCode({ phone, code: wrong, alerts: false })).toEqual({ status: 'error', code: 'INVALID_OTP' })
    expect(await verifyWhatsAppCode({ phone, code, alerts: false })).toEqual({ status: 'error', code: 'TOO_MANY_ATTEMPTS' })
  })

  it('answers OTP_EXPIRED when no code is waiting for that number', async () => {
    enableCodes()
    await signedInUser()
    expect(await verifyWhatsAppCode({ phone: newPhone(), code: '123456', alerts: false })).toEqual({ status: 'error', code: 'OTP_EXPIRED' })
  })

  it('answers NUMBER_TAKEN for a number another account has proven, and leaves the code unspent', async () => {
    enableCodes()
    const phone = newPhone()
    const { id: otherId } = await signedInUser()
    await db.update(user).set({ phoneNumber: phone, phoneNumberVerified: true }).where(eq(user.id, otherId))
    const { id, cookie } = await signedInUser()

    expect(await verifyWhatsAppCode({ phone, code: '123456', alerts: true })).toEqual({ status: 'error', code: 'NUMBER_TAKEN' })

    const [row] = await db.select().from(user).where(eq(user.id, id))
    expect(row.phoneNumber).toBeNull()
    expect(await db.select().from(whatsappLink).where(eq(whatsappLink.userId, id))).toEqual([])
    // The send route refuses it too, so nobody is messaged.
    const res = await auth.handler(authRequest('/api/auth/phone-number/send-otp', { body: { phoneNumber: phone }, cookie }))
    expect(((await res.json()) as { code?: string }).code).toBe('NUMBER_TAKEN')
  })

  it('answers UNAUTHORIZED without a session', async () => {
    enableCodes()
    requestHeaders.current = new Headers()
    expect(await verifyWhatsAppCode({ phone: newPhone(), code: '123456', alerts: true })).toEqual({ status: 'error', code: 'UNAUTHORIZED' })
  })
})
