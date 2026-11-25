import { beforeAll, describe, expect, it } from 'vitest'
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

  it('refuses a code request for a number that is not in E.164 form', async () => {
    const res = await post('/phone-number/send-otp', { phoneNumber: '677123456' })
    expect(res.status).toBe(400)
    expect(((await res.json()) as { code?: string }).code).toBe('INVALID_PHONE_NUMBER')
  })
})
