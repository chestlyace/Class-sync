import type { ReactElement } from 'react'
import { render } from '@react-email/render'
import { eq } from 'drizzle-orm'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { config, setConfigForTests } from '@/server/core/config'
import type { Db } from '@/server/db'
import { session, user } from '@/server/db/schema'
import { createTestDb } from '@/test/db'
import { createAuth } from './auth'
import { resetPasswordAndSignIn } from './reset-password'

const sent = vi.hoisted(() => [] as { subject: string; react: ReactElement }[])
vi.mock('@/server/email/send', () => ({
  sendEmail: vi.fn(async (args: { subject: string; react: ReactElement }) => {
    sent.push({ subject: args.subject, react: args.react })
  }),
}))

const BASE = 'http://localhost:3000'
const OLD_PASSWORD = 'correct-horse-9'
const NEW_PASSWORD = 'a-brand-new-pass-7'
const headers = () => new Headers({ origin: BASE })

describe('resetPasswordAndSignIn', () => {
  const original = config.requireEmailVerification
  let db: Db
  let auth: ReturnType<typeof createAuth>

  beforeAll(async () => {
    // As in production: an unverified account can only sign in once the reset verified it.
    setConfigForTests({ requireEmailVerification: true })
    db = await createTestDb()
    auth = createAuth(db, { baseURL: BASE, secret: 'test-secret-test-secret-test-secret-123', nextCookies: false })
  })
  afterAll(() => setConfigForTests({ requireEmailVerification: original }))
  beforeEach(() => {
    sent.length = 0
  })

  async function accountWithResetLink(email: string): Promise<{ userId: string; token: string }> {
    const { user: created } = await auth.api.signUpEmail({ body: { name: 'Ama', email, password: OLD_PASSWORD, role: 'student', locale: 'en' } as never })
    await auth.api.requestPasswordReset({ body: { email } })
    for (let i = 0; i < 50 && !sent.some((s) => s.subject === 'Reset your Clasync password'); i++) await new Promise((r) => setTimeout(r, 20))
    const text = await render(sent.find((s) => s.subject === 'Reset your Clasync password')!.react, { plainText: true })
    return { userId: created.id, token: /reset-password\?token=([\w-]+)/.exec(text)![1]! }
  }

  it('changes the password and signs this browser in, even for an account that never verified', async () => {
    const { userId, token } = await accountWithResetLink('ama-reset@example.com')
    expect(await resetPasswordAndSignIn(auth, { token, newPassword: NEW_PASSWORD, headers: headers() }, { db })).toEqual({ status: 'signed-in' })
    expect(await db.select().from(session).where(eq(session.userId, userId))).toHaveLength(1)
  })

  it('leaves the account alone for a dead link', async () => {
    const outcome = await resetPasswordAndSignIn(auth, { token: 'no-such-token', newPassword: NEW_PASSWORD, headers: headers() }, { db })
    expect(outcome).toEqual({ status: 'error', code: 'INVALID_TOKEN' })
  })

  it('reports a password that is too short without spending the link', async () => {
    const { token } = await accountWithResetLink('short-pass@example.com')
    const outcome = await resetPasswordAndSignIn(auth, { token, newPassword: 'short', headers: headers() }, { db })
    expect(outcome).toMatchObject({ status: 'error', code: 'PASSWORD_TOO_SHORT' })
    expect(await resetPasswordAndSignIn(auth, { token, newPassword: NEW_PASSWORD, headers: headers() }, { db })).toEqual({ status: 'signed-in' })
  })

  it('still changes the password when signing in is refused, and says so', async () => {
    const { userId, token } = await accountWithResetLink('suspended-reset@example.com')
    await db.update(user).set({ suspendedAt: new Date() }).where(eq(user.id, userId))
    expect(await resetPasswordAndSignIn(auth, { token, newPassword: NEW_PASSWORD, headers: headers() }, { db })).toEqual({ status: 'reset' })
    expect(await db.select().from(session).where(eq(session.userId, userId))).toHaveLength(0)
  })
})
