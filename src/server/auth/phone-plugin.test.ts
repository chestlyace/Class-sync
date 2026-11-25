import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { config, setConfigForTests } from '@/server/core/config'
import { createTestDb } from '@/test/db'
import { createAuth } from './auth'

const BASE = 'http://localhost:3000'

describe('auth: phone-number plugin', () => {
  let auth: ReturnType<typeof createAuth>

  beforeAll(async () => {
    setConfigForTests({ requireEmailVerification: false })
    const db = await createTestDb()
    auth = createAuth(db, {
      baseURL: BASE,
      secret: 'test-secret-test-secret-test-secret-123',
      nextCookies: false,
    })
    return () => setConfigForTests({ requireEmailVerification: config.requireEmailVerification })
  })

  function post(path: string, body: unknown) {
    return auth.handler(
      new Request(`${BASE}/api/auth${path}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', origin: BASE },
        body: JSON.stringify(body),
      }),
    )
  }

  it('refuses a sign-up that carries a phone number', async () => {
    const res = await post('/sign-up/email', {
      name: 'Stu',
      email: 'phone-stu@example.com',
      password: 'correct-horse-9',
      role: 'student',
      locale: 'en',
      phoneNumber: '+237677123456',
    })
    expect(res.status).toBe(400)
    expect(((await res.json()) as { code?: string }).code).toBe('PHONE_NUMBER_CANNOT_BE_SET')
  })

  afterEach(() => vi.unstubAllEnvs())

  function enableCodes() {
    vi.stubEnv('WHATSAPP_AWS_REGION', 'eu-north-1')
    vi.stubEnv('WHATSAPP_AWS_ROLE_ARN', 'arn:aws:iam::1:role/x')
    vi.stubEnv('WHATSAPP_PHONE_NUMBER_ID', 'phone-number-id-1')
    vi.stubEnv('WHATSAPP_DISPLAY_NUMBER', '+15558903752')
    vi.stubEnv('WHATSAPP_SNS_TOPIC_ARN', 'arn:aws:sns:eu-north-1:1:topic')
    vi.stubEnv('WHATSAPP_OTP_ENABLED', 'true')
  }

  it('refuses a code request for a number that is not in E.164 form', async () => {
    // The guard answers 404 while WhatsApp codes are off, so switch them on first.
    enableCodes()
    // '12ab' cannot be turned into a number; a bare local number such as 677123456 is normalised instead.
    const res = await post('/phone-number/send-otp', { phoneNumber: '12ab' })
    expect(res.status).toBe(400)
    expect(((await res.json()) as { code?: string }).code).toBe('INVALID_PHONE_NUMBER')
  })

  it('normalises a local number, then refuses an anonymous code request', async () => {
    enableCodes()
    const res = await post('/phone-number/send-otp', { phoneNumber: '677123456' })
    expect(res.status).toBe(401)
    expect(((await res.json()) as { code?: string }).code).toBe('UNAUTHORIZED')
  })
})
