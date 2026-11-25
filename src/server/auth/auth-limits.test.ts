import type { ReactElement } from 'react'
import { render } from '@react-email/render'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { config, setConfigForTests } from '@/server/core/config'
import { createTestDb } from '@/test/db'
import { createAuth } from './auth'

// Count verification emails instead of sending (or logging) them.
const sent = vi.hoisted(() => [] as { to: string; subject: string }[])
const bodies = vi.hoisted(() => [] as ReactElement[])
vi.mock('@/server/email/send', () => ({
  sendEmail: vi.fn(async (args: { to: string; subject: string; react: ReactElement }) => {
    sent.push({ to: args.to, subject: args.subject })
    bodies.push(args.react)
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

describe('auth: verification links', () => {
  const original = config.requireEmailVerification
  let auth: ReturnType<typeof createAuth>

  beforeAll(async () => {
    setConfigForTests({ requireEmailVerification: true })
    auth = createAuth(await createTestDb(), { baseURL: BASE, secret: SECRET, nextCookies: false })
  })
  afterAll(() => setConfigForTests({ requireEmailVerification: original }))
  beforeEach(() => {
    sent.length = 0
    bodies.length = 0
  })

  it('sends a verification link that stays valid for 7 days (students may open it days later)', async () => {
    const email = 'late@example.com'
    const signUp = await post(auth, '/sign-up/email', { name: 'Late', email, password: PASSWORD, role: 'student' })
    expect(signUp.status).toBe(200)
    // Sign-up sends nothing by itself; the link is asked for (the verify banner's resend button).
    expect(sent).toEqual([])
    expect((await post(auth, '/send-verification-email', { email, callbackURL: '/dashboard' })).status).toBe(200)
    await until(() => bodies.length >= 1)
    const text = await render(bodies[0]!, { plainText: true })
    const token = /verify-email\?token=([\w-]+\.[\w-]+\.[\w-]+)/.exec(text)?.[1]
    expect(token).toBeDefined()
    const payload = JSON.parse(Buffer.from(token!.split('.')[1]!, 'base64url').toString()) as { iat: number; exp: number }
    expect(payload.exp - payload.iat).toBe(7 * 24 * 60 * 60)
  })

  it('lets an unverified user sign in (limited session) without sending a verification email', async () => {
    const email = 'unverified@example.com'
    const signUp = await post(auth, '/sign-up/email', { name: 'Una', email, password: PASSWORD, role: 'student' })
    expect(signUp.status).toBe(200)

    const signIn = await post(auth, '/sign-in/email', { email, password: PASSWORD })
    expect(signIn.status).toBe(200)
    expect(signIn.headers.getSetCookie().join(';')).toContain('session_token')
    await new Promise((r) => setTimeout(r, 100))
    expect(sent).toEqual([])
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

  it('allows 100 sign-ins per minute from one address (a class behind one NAT at the start of a test), then answers 429', async () => {
    const ip = '198.51.100.7'
    const statuses: number[] = []
    for (let i = 0; i < 101; i++) {
      statuses.push((await post(auth, '/sign-in/email', { email: `nobody${i}@example.com`, password: PASSWORD }, ip)).status)
    }
    expect(statuses.slice(0, 100).every((s) => s === 401)).toBe(true)
    expect(statuses[100]).toBe(429)
    // Another address is unaffected.
    expect((await post(auth, '/sign-in/email', { email: 'x@example.com', password: PASSWORD }, '198.51.100.8')).status).toBe(401)
  }, 120_000)

  it('still allows only 30 sign-ups per minute from one address, then answers 429', async () => {
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

  it('allows 100 password-reset requests per minute from one address (a class behind one NAT), then answers 429', async () => {
    const ip = '198.51.100.10'
    const statuses: number[] = []
    for (let i = 0; i < 101; i++) {
      // An unknown address still gets the generic success, so only the limiter can answer 429.
      statuses.push((await post(auth, '/request-password-reset', { email: `nobody${i}@example.com` }, ip)).status)
    }
    expect(statuses.slice(0, 100).every((s) => s === 200)).toBe(true)
    expect(statuses[100]).toBe(429)
  }, 120_000)
})
