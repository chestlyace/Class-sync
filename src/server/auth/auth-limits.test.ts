import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { config, setConfigForTests } from '@/server/core/config'
import { createTestDb } from '@/test/db'
import { createAuth } from './auth'

// Count verification emails instead of sending (or logging) them.
const sent = vi.hoisted(() => [] as { to: string; subject: string }[])
vi.mock('@/server/email/send', () => ({
  sendEmail: vi.fn(async (args: { to: string; subject: string }) => {
    sent.push({ to: args.to, subject: args.subject })
  }),
}))

const BASE = 'http://localhost:3000'
const SECRET = 'test-secret-test-secret-test-secret-123'
const PASSWORD = 'correct-horse-9'

function post(auth: ReturnType<typeof createAuth>, path: string, body: unknown, ip = '203.0.113.1') {
  return auth.handler(
    new Request(`${BASE}/api/auth${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: BASE, 'x-forwarded-for': ip },
      body: JSON.stringify(body),
    }),
  )
}

/** Waits for background work (Better Auth may send emails after responding). */
async function until(check: () => boolean) {
  for (let i = 0; i < 50 && !check(); i++) await new Promise((r) => setTimeout(r, 20))
}

describe('auth: verification lockout', () => {
  const original = config.requireEmailVerification
  let auth: ReturnType<typeof createAuth>

  beforeAll(async () => {
    setConfigForTests({ requireEmailVerification: true })
    auth = createAuth(await createTestDb(), { baseURL: BASE, secret: SECRET, nextCookies: false })
  })
  afterAll(() => setConfigForTests({ requireEmailVerification: original }))
  beforeEach(() => {
    sent.length = 0
  })

  it('sends a fresh verification link when an unverified user tries to sign in', async () => {
    const email = 'unverified@example.com'
    const signUp = await post(auth, '/sign-up/email', { name: 'Una', email, password: PASSWORD, role: 'student' })
    expect(signUp.status).toBe(200)
    await until(() => sent.length >= 1)
    expect(sent).toEqual([{ to: email, subject: expect.any(String) }])

    const signIn = await post(auth, '/sign-in/email', { email, password: PASSWORD })
    expect(signIn.status).toBe(403)
    expect(((await signIn.json()) as { code: string }).code).toBe('EMAIL_NOT_VERIFIED')
    await until(() => sent.length >= 2)
    expect(sent.map((m) => m.to)).toEqual([email, email])
  })
})

describe('auth: rate limits sized for a classroom', () => {
  let auth: ReturnType<typeof createAuth>

  beforeAll(async () => {
    setConfigForTests({ requireEmailVerification: false })
    // Better Auth only rate-limits in production unless told otherwise.
    auth = createAuth(await createTestDb(), {
      baseURL: BASE,
      secret: SECRET,
      nextCookies: false,
      rateLimitEnabled: true,
    })
  })

  it('allows 30 sign-ins per minute from one address (a class behind one NAT), then answers 429', async () => {
    const ip = '198.51.100.7'
    const statuses: number[] = []
    for (let i = 0; i < 31; i++) {
      statuses.push((await post(auth, '/sign-in/email', { email: `nobody${i}@example.com`, password: PASSWORD }, ip)).status)
    }
    expect(statuses.slice(0, 30).every((s) => s === 401)).toBe(true)
    expect(statuses[30]).toBe(429)
    // Another address is unaffected.
    expect((await post(auth, '/sign-in/email', { email: 'x@example.com', password: PASSWORD }, '198.51.100.8')).status).toBe(401)
  })

  it('allows 30 sign-ups per minute from one address, then answers 429', async () => {
    const ip = '198.51.100.9'
    const statuses: number[] = []
    for (let i = 0; i < 31; i++) {
      const res = await post(
        auth,
        '/sign-up/email',
        { name: `Student ${i}`, email: `student${i}@example.com`, password: PASSWORD, role: 'student' },
        ip,
      )
      statuses.push(res.status)
    }
    expect(statuses.slice(0, 30).every((s) => s === 200)).toBe(true)
    expect(statuses[30]).toBe(429)
  })
})
