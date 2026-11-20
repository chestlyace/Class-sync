import type { ReactElement } from 'react'
import { render } from '@react-email/render'
import { eq } from 'drizzle-orm'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { setNowForTests } from '@/server/core/clock'
import { config, setConfigForTests } from '@/server/core/config'
import type { Db } from '@/server/db'
import { sendEmail } from '@/server/email/send'
import { session, user, verification } from '@/server/db/schema'
import { createTestDb } from '@/test/db'
import { createAuth } from './auth'

// Capture emails (and their rendered bodies) instead of sending or logging them.
const sent = vi.hoisted(() => [] as { to: string; subject: string; react: ReactElement }[])
vi.mock('@/server/email/send', () => ({
  sendEmail: vi.fn(async (args: { to: string; subject: string; react: ReactElement }) => {
    sent.push({ to: args.to, subject: args.subject, react: args.react })
  }),
}))

const BASE = 'http://localhost:3000'
const SECRET = 'test-secret-test-secret-test-secret-123'
const OLD_PASSWORD = 'correct-horse-9'
const NEW_PASSWORD = 'a-brand-new-pass-7'

function post(auth: ReturnType<typeof createAuth>, path: string, body: unknown, cookie?: string) {
  return auth.handler(
    new Request(`${BASE}/api/auth${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: BASE, ...(cookie ? { cookie } : {}) },
      body: JSON.stringify(body),
    }),
  )
}

/** Waits for background work (Better Auth may send the email after responding). */
async function until(check: () => boolean) {
  for (let i = 0; i < 50 && !check(); i++) await new Promise((r) => setTimeout(r, 20))
}

/** Extracts the token from the link in the last email body. */
async function lastResetToken(): Promise<string> {
  await until(() => sent.length >= 1)
  const text = await render(sent[sent.length - 1]!.react, { plainText: true })
  const token = /reset-password\?token=([\w-]+)/.exec(text)?.[1]
  expect(token).toBeDefined()
  return token!
}

/** The full reset link in the last email, so its query can be inspected. */
async function lastResetUrl(): Promise<URL> {
  await until(() => sent.length >= 1)
  const text = await render(sent[sent.length - 1]!.react, { plainText: true })
  const raw = /https?:\/\/[^\s"'<>]+reset-password\?token=[^\s"'<>]+/.exec(text)?.[0]
  expect(raw).toBeDefined()
  return new URL(raw!.replace(/&amp;/g, '&'))
}

describe('auth: password reset', () => {
  const original = config.requireEmailVerification
  let db: Db
  let auth: ReturnType<typeof createAuth>

  beforeAll(async () => {
    setConfigForTests({ requireEmailVerification: false })
    db = await createTestDb()
    auth = createAuth(db, { baseURL: BASE, secret: SECRET, nextCookies: false })
  })
  afterAll(() => setConfigForTests({ requireEmailVerification: original }))
  beforeEach(() => {
    sent.length = 0
  })

  async function signUp(email: string, locale = 'en') {
    const res = await post(auth, '/sign-up/email', { name: 'Reset Me', email, password: OLD_PASSWORD, role: 'student', locale })
    expect(res.status).toBe(200)
    return ((await res.json()) as { user: { id: string } }).user.id
  }

  it('does not reveal whether an unknown address has an account, and sends no email', async () => {
    const res = await post(auth, '/request-password-reset', { email: 'nobody@example.com' })
    expect(res.status).toBe(200)
    expect(((await res.json()) as { status: boolean }).status).toBe(true)
    await new Promise((r) => setTimeout(r, 50))
    expect(sent).toEqual([])
  })

  it('sends a localized reset link and lets the token set a new password', async () => {
    const email = 'reset-me@example.com'
    await signUp(email, 'fr')
    const request = await post(auth, '/request-password-reset', { email })
    expect(request.status).toBe(200)
    await until(() => sent.length >= 1)
    expect(sent[0]?.to).toBe(email)
    expect(sent[0]?.subject).toMatch(/mot de passe/i)
    const token = await lastResetToken()

    const reset = await post(auth, '/reset-password', { newPassword: NEW_PASSWORD, token })
    expect(reset.status).toBe(200)
    expect(((await reset.json()) as { status: boolean }).status).toBe(true)

    // The new password works and the old one no longer does.
    expect((await post(auth, '/sign-in/email', { email, password: NEW_PASSWORD })).status).toBe(200)
    expect((await post(auth, '/sign-in/email', { email, password: OLD_PASSWORD })).status).toBe(401)
  })

  it('revokes existing sessions when the password changes', async () => {
    const email = 'revoke-me@example.com'
    const userId = await signUp(email)
    const sessionsForUser = () => db.select().from(session).where(eq(session.userId, userId))
    expect(await sessionsForUser()).not.toEqual([])
    const request = await post(auth, '/request-password-reset', { email })
    expect(request.status).toBe(200)
    const token = await lastResetToken()

    expect((await post(auth, '/reset-password', { newPassword: NEW_PASSWORD, token })).status).toBe(200)
    expect(await sessionsForUser()).toEqual([])
  })

  it('refuses to reuse a spent token', async () => {
    const email = 'reuse-me@example.com'
    await signUp(email)
    expect((await post(auth, '/request-password-reset', { email })).status).toBe(200)
    const token = await lastResetToken()
    expect((await post(auth, '/reset-password', { newPassword: NEW_PASSWORD, token })).status).toBe(200)
    const again = await post(auth, '/reset-password', { newPassword: 'another-pass-8', token })
    expect(again.status).toBe(400)
    expect(((await again.json()) as { code?: string }).code).toBe('INVALID_TOKEN')
  })

  it('refuses an unknown token', async () => {
    const res = await post(auth, '/reset-password', { newPassword: NEW_PASSWORD, token: 'not-a-real-token' })
    expect(res.status).toBe(400)
    expect(((await res.json()) as { code?: string }).code).toBe('INVALID_TOKEN')
  })

  it('stores the reset token with a 24-hour expiry', async () => {
    const email = 'expiry-me@example.com'
    await signUp(email)
    expect((await post(auth, '/request-password-reset', { email })).status).toBe(200)
    const token = await lastResetToken()
    const [row] = await db.select().from(verification).where(eq(verification.identifier, `reset-password:${token}`))
    expect(row).toBeDefined()
    const hours = (row!.expiresAt.getTime() - Date.now()) / (60 * 60 * 1000)
    expect(hours).toBeGreaterThan(23)
    expect(hours).toBeLessThanOrEqual(24)
  })

  it('does not send another link for the same address inside the cooldown', async () => {
    const email = 'cooldown-me@example.com'
    await signUp(email)
    expect((await post(auth, '/request-password-reset', { email })).status).toBe(200)
    await until(() => sent.length >= 1)
    expect((await post(auth, '/request-password-reset', { email })).status).toBe(200)
    await new Promise((r) => setTimeout(r, 50))
    expect(sent).toHaveLength(1)
  })

  it('sends another link once the per-address cooldown has passed', async () => {
    const email = 'cooldown-two@example.com'
    await signUp(email)
    expect((await post(auth, '/request-password-reset', { email })).status).toBe(200)
    await until(() => sent.length >= 1)
    setNowForTests(() => new Date(Date.now() + 6 * 60 * 1000))
    try {
      expect((await post(auth, '/request-password-reset', { email })).status).toBe(200)
      await until(() => sent.length >= 2)
      expect(sent).toHaveLength(2)
    } finally {
      setNowForTests(null)
    }
  })

  it('carries a safe next destination into the emailed link', async () => {
    const email = 'next-me@example.com'
    await signUp(email)
    const res = await post(auth, '/request-password-reset', { email, redirectTo: '/courses/bio?tab=1' })
    expect(res.status).toBe(200)
    const url = await lastResetUrl()
    expect(url.searchParams.get('token')).toBeTruthy()
    expect(url.searchParams.get('next')).toBe('/courses/bio?tab=1')
  })

  it('answers normally even when the email provider fails', async () => {
    const email = 'resend-fail@example.com'
    await signUp(email)
    const errorLog = vi.spyOn(console, 'error').mockImplementation(() => {})
    try {
      vi.mocked(sendEmail).mockRejectedValueOnce(new Error('Resend is down'))
      expect((await post(auth, '/request-password-reset', { email })).status).toBe(200)
      await new Promise((r) => setTimeout(r, 50))
      expect(errorLog).toHaveBeenCalled()
    } finally {
      errorLog.mockRestore()
    }
  })

  it('does not wait for the email provider before answering', async () => {
    const email = 'slow-mail@example.com'
    await signUp(email)
    let release: (() => void) | undefined
    let finished = false
    vi.mocked(sendEmail).mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          release = () => {
            finished = true
            resolve()
          }
        }),
    )
    try {
      const status = await Promise.race([
        post(auth, '/request-password-reset', { email }).then((res) => res.status),
        new Promise<'pending'>((resolve) => setTimeout(() => resolve('pending'), 500)),
      ])
      expect(status).toBe(200)
      expect(finished).toBe(false)
    } finally {
      release?.()
    }
  })

  it('sends a link when the address asks again after a send that failed', async () => {
    const email = 'first-send-failed@example.com'
    await signUp(email)
    const errorLog = vi.spyOn(console, 'error').mockImplementation(() => {})
    try {
      vi.mocked(sendEmail).mockRejectedValueOnce(new Error('daily email sending quota'))
      expect((await post(auth, '/request-password-reset', { email })).status).toBe(200)
      await until(() => errorLog.mock.calls.length > 0)
      expect((await post(auth, '/request-password-reset', { email })).status).toBe(200)
      await until(() => sent.length >= 1)
      expect(sent).toHaveLength(1)
    } finally {
      errorLog.mockRestore()
    }
  })

  it('withdraws the link of a send that failed', async () => {
    const email = 'unsent-link@example.com'
    const userId = await signUp(email)
    const errorLog = vi.spyOn(console, 'error').mockImplementation(() => {})
    try {
      vi.mocked(sendEmail).mockRejectedValueOnce(new Error('Resend is down'))
      expect((await post(auth, '/request-password-reset', { email })).status).toBe(200)
      await until(() => errorLog.mock.calls.length > 0)
      await new Promise((r) => setTimeout(r, 50))
      const links = await db.select().from(verification).where(eq(verification.value, userId))
      expect(links.filter((row) => row.identifier.startsWith('reset-password:'))).toEqual([])
    } finally {
      errorLog.mockRestore()
    }
  })
})

describe('auth: password reset with email verification on', () => {
  const original = config.requireEmailVerification
  let db: Db
  let auth: ReturnType<typeof createAuth>

  beforeAll(async () => {
    setConfigForTests({ requireEmailVerification: true })
    db = await createTestDb()
    auth = createAuth(db, { baseURL: BASE, secret: SECRET, nextCookies: false })
  })
  afterAll(() => setConfigForTests({ requireEmailVerification: original }))
  beforeEach(() => {
    sent.length = 0
  })

  it('verifies the address, so an account that never verified can sign in after a reset', async () => {
    const email = 'never-verified@example.com'
    const signUpRes = await post(auth, '/sign-up/email', { name: 'Not Verified', email, password: OLD_PASSWORD, role: 'student', locale: 'en' })
    expect(signUpRes.status).toBe(200)
    expect((await post(auth, '/sign-in/email', { email, password: OLD_PASSWORD })).status).toBe(403)

    expect((await post(auth, '/request-password-reset', { email })).status).toBe(200)
    await until(() => sent.some((s) => s.subject === 'Reset your Clasync password'))
    const resetEmail = sent.find((s) => s.subject === 'Reset your Clasync password')!
    const text = await render(resetEmail.react, { plainText: true })
    const token = /reset-password\?token=([\w-]+)/.exec(text)![1]!
    expect((await post(auth, '/reset-password', { newPassword: NEW_PASSWORD, token })).status).toBe(200)

    const [row] = await db.select({ emailVerified: user.emailVerified }).from(user).where(eq(user.email, email))
    expect(row?.emailVerified).toBe(true)
    expect((await post(auth, '/sign-in/email', { email, password: NEW_PASSWORD })).status).toBe(200)
  })
})
