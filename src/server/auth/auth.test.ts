import { eq } from 'drizzle-orm'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { config, setConfigForTests } from '@/server/core/config'
import type { Db } from '@/server/db'
import { session, user } from '@/server/db/schema'
import { createTestDb } from '@/test/db'
import { authorizeToConsent, authRequest, cookiesOf, registerClient, runOAuthFlow } from '@/test/mcp-oauth'
import { createAuth } from './auth'

// Count emails instead of sending (or logging) them.
const sent = vi.hoisted(() => [] as { to: string }[])
vi.mock('@/server/email/send', () => ({
  sendEmail: vi.fn(async (args: { to: string }) => {
    sent.push({ to: args.to })
  }),
}))

const BASE = 'http://localhost:3000'

describe('auth: user updates', () => {
  const original = config.requireEmailVerification
  let db: Db
  let auth: ReturnType<typeof createAuth>
  let cookie: string
  let userId: string

  async function post(path: string, body: unknown, withCookie = true) {
    return auth.handler(
      new Request(`${BASE}/api/auth${path}`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          origin: BASE,
          ...(withCookie ? { cookie } : {}),
        },
        body: JSON.stringify(body),
      }),
    )
  }

  beforeAll(async () => {
    setConfigForTests({ requireEmailVerification: false })
    db = await createTestDb()
    auth = createAuth(db, {
      baseURL: BASE,
      secret: 'test-secret-test-secret-test-secret-123',
      nextCookies: false,
    })
    const res = await post(
      '/sign-up/email',
      { name: 'Stu', email: 'stu@example.com', password: 'correct-horse-9', role: 'student', locale: 'en' },
      false,
    )
    expect(res.status).toBe(200)
    cookie = res.headers
      .getSetCookie()
      .map((c) => c.split(';')[0])
      .join('; ')
    userId = ((await res.json()) as { user: { id: string } }).user.id
  })

  afterAll(() => setConfigForTests({ requireEmailVerification: original }))

  async function dbUser() {
    const [row] = await db.select().from(user).where(eq(user.id, userId))
    return row
  }

  it('rejects a role change through /update-user and leaves the role untouched', async () => {
    const res = await post('/update-user', { role: 'lecturer' })
    expect(res.status).toBe(400)
    expect((await dbUser()).role).toBe('student')
  })

  it('rejects an invalid locale with 400 (not a 500 from the CHECK constraint)', async () => {
    const res = await post('/update-user', { locale: 'xx' })
    expect(res.status).toBe(400)
    expect((await dbUser()).locale).toBe('en')
  })

  it('accepts a valid locale and other profile updates', async () => {
    const res = await post('/update-user', { locale: 'fr', name: 'Stu Dent' })
    expect(res.status).toBe(200)
    const row = await dbUser()
    expect(row.locale).toBe('fr')
    expect(row.name).toBe('Stu Dent')
  })

  it('refuses to set or remove the WhatsApp number through /update-user', async () => {
    await db.update(user).set({ phoneNumber: '+237677005501', phoneNumberVerified: true }).where(eq(user.id, userId))
    const removal = await post('/update-user', { phoneNumber: null })
    expect(removal.status).toBe(400)
    expect(((await removal.json()) as { code?: string }).code).toBe('PHONE_NUMBER_CANNOT_BE_UPDATED')
    expect((await post('/update-user', { phoneNumberVerified: false })).status).toBe(400)
    expect((await post('/update-user', { phoneNumber: '+237677005502' })).status).toBe(400)
    expect(await dbUser()).toMatchObject({ phoneNumber: '+237677005501', phoneNumberVerified: true })
    await db.update(user).set({ phoneNumber: null, phoneNumberVerified: false }).where(eq(user.id, userId))
  })

  it('refuses a sign-up whose name carries a link, with its own error code', async () => {
    const res = await post(
      '/sign-up/email',
      { name: 'BUY NOW https://example.com/LURE', email: 'lure@example.com', password: 'correct-horse-9', role: 'student' },
      false,
    )
    expect(res.status).toBe(400)
    expect(((await res.json()) as { code?: string }).code).toBe('INVALID_NAME')
    expect(await db.select().from(user).where(eq(user.email, 'lure@example.com'))).toEqual([])
  })

  it('stores a cleaned name at sign-up and refuses a bad rename', async () => {
    const res = await post(
      '/sign-up/email',
      { name: '  Ngo  Marie ', email: 'ngo@example.com', password: 'correct-horse-9', role: 'student' },
      false,
    )
    expect(res.status).toBe(200)
    const [row] = await db.select().from(user).where(eq(user.email, 'ngo@example.com'))
    expect(row.name).toBe('Ngo Marie')
    const rename = await post('/update-user', { name: '<b>HTMLBOLD</b>' })
    expect(rename.status).toBe(400)
    expect((await dbUser()).name).not.toBe('<b>HTMLBOLD</b>')
  })

  it('still rejects an admin role at sign-up', async () => {
    const res = await post(
      '/sign-up/email',
      { name: 'X', email: 'x@example.com', password: 'correct-horse-9', role: 'admin' },
      false,
    )
    expect(res.status).toBe(400)
  })
})

describe('auth: suspension', () => {
  const original = config.requireEmailVerification
  let db: Db
  let auth: ReturnType<typeof createAuth>
  let userId: string
  const credentials = { email: 'lec@example.com', password: 'correct-horse-9' }

  function post(path: string, body: unknown) {
    return auth.handler(
      new Request(`${BASE}/api/auth${path}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', origin: BASE },
        body: JSON.stringify(body),
      }),
    )
  }

  async function sessionCount() {
    return (await db.select({ id: session.id }).from(session).where(eq(session.userId, userId))).length
  }

  beforeAll(async () => {
    setConfigForTests({ requireEmailVerification: false })
    db = await createTestDb()
    auth = createAuth(db, { baseURL: BASE, secret: 'test-secret-test-secret-test-secret-123', nextCookies: false })
    const res = await post('/sign-up/email', { name: 'Lec', ...credentials, role: 'lecturer', locale: 'en' })
    expect(res.status).toBe(200)
    userId = ((await res.json()) as { user: { id: string } }).user.id
  })

  afterAll(() => setConfigForTests({ requireEmailVerification: original }))

  it('records last_sign_in_at when a session is created', async () => {
    await db.update(user).set({ lastSignInAt: null }).where(eq(user.id, userId))
    const res = await post('/sign-in/email', credentials)
    expect(res.status).toBe(200)
    const [row] = await db.select({ lastSignInAt: user.lastSignInAt }).from(user).where(eq(user.id, userId))
    expect(row.lastSignInAt).toBeInstanceOf(Date)
  })

  it('refuses a suspended account with ACCOUNT_SUSPENDED and creates no session', async () => {
    await db.update(user).set({ suspendedAt: new Date() }).where(eq(user.id, userId))
    const before = await sessionCount()
    const res = await post('/sign-in/email', credentials)
    expect(res.status).not.toBe(200)
    expect(await res.json()).toMatchObject({ code: 'ACCOUNT_SUSPENDED' })
    expect(await sessionCount()).toBe(before)
  })

  it('lets the account sign in again once the suspension is cleared', async () => {
    await db.update(user).set({ suspendedAt: null }).where(eq(user.id, userId))
    const res = await post('/sign-in/email', credentials)
    expect(res.status).toBe(200)
  })
})

describe('auth: an account is verified by its email or its WhatsApp number', () => {
  const original = config.requireEmailVerification
  const PASSWORD = 'correct-horse-9'
  let db: Db
  let auth: ReturnType<typeof createAuth>

  function post(path: string, body: unknown, cookie?: string) {
    return auth.handler(authRequest(`/api/auth${path}`, { body, cookie }))
  }

  async function signUp(email: string, role: 'lecturer' | 'student' = 'lecturer') {
    return post('/sign-up/email', { name: 'Newcomer', email, password: PASSWORD, role, locale: 'en' })
  }

  async function userByEmail(email: string) {
    const [row] = await db.select().from(user).where(eq(user.email, email))
    return row
  }

  beforeAll(async () => {
    setConfigForTests({ requireEmailVerification: true })
    db = await createTestDb()
    auth = createAuth(db, { baseURL: BASE, secret: 'test-secret-test-secret-test-secret-123', nextCookies: false })
  })
  afterAll(() => setConfigForTests({ requireEmailVerification: original }))
  beforeEach(() => {
    sent.length = 0
  })

  it('answers a sign-up with 200, no session and no email of its own', async () => {
    const res = await signUp('fresh@example.com')
    expect(res.status).toBe(200)
    expect(cookiesOf(res)).not.toContain('session_token')
    const row = await userByEmail('fresh@example.com')
    expect(row.emailVerified).toBe(false)
    expect(row.phoneNumberVerified).toBe(false)
    expect(await db.select().from(session).where(eq(session.userId, row.id))).toEqual([])
    await new Promise((r) => setTimeout(r, 50))
    expect(sent).toEqual([])
  })

  it('answers a sign-up with an address already in use in the same way (nothing leaks which addresses exist)', async () => {
    const first = await signUp('taken@example.com')
    const second = await signUp('taken@example.com', 'student')
    expect(second.status).toBe(200)
    expect(cookiesOf(second)).not.toContain('session_token')
    const shape = async (res: Response) => {
      const json = (await res.json()) as { token: unknown; user: Record<string, unknown> }
      return { token: json.token, userKeys: Object.keys(json.user).sort() }
    }
    expect(await shape(second)).toEqual(await shape(first))
    // The first account is untouched: still one row, still a lecturer.
    const rows = await db.select().from(user).where(eq(user.email, 'taken@example.com'))
    expect(rows).toHaveLength(1)
    expect(rows[0].role).toBe('lecturer')
  })

  it('lets an unverified account sign in with a limited session, and sends no email', async () => {
    await signUp('limited@example.com')
    const row = await userByEmail('limited@example.com')
    const res = await post('/sign-in/email', { email: 'limited@example.com', password: PASSWORD })
    expect(res.status).toBe(200)
    expect(cookiesOf(res)).toContain('session_token')
    expect(await db.select().from(session).where(eq(session.userId, row.id))).toHaveLength(1)
    await new Promise((r) => setTimeout(r, 50))
    expect(sent).toEqual([])
    // Still unverified: the session does not make the account verified.
    expect((await userByEmail('limited@example.com')).emailVerified).toBe(false)
  })

  it('still refuses a wrong password', async () => {
    await signUp('wrong@example.com')
    const res = await post('/sign-in/email', { email: 'wrong@example.com', password: 'not-the-password-1' })
    expect(res.status).toBe(401)
    expect(cookiesOf(res)).not.toContain('session_token')
  })

  it('lets a lecturer verified only by WhatsApp allow an assistant, and refuses an unverified one', async () => {
    const clientId = await registerClient(auth)

    await signUp('wa-lecturer@example.com')
    const verified = await userByEmail('wa-lecturer@example.com')
    await db.update(user).set({ phoneNumberVerified: true }).where(eq(user.id, verified.id))
    const verifiedCookie = cookiesOf(await post('/sign-in/email', { email: 'wa-lecturer@example.com', password: PASSWORD }))
    const { tokens } = await runOAuthFlow(auth, { clientId, cookie: verifiedCookie })
    expect(tokens.access_token).toBeTruthy()

    await signUp('plain-lecturer@example.com')
    const plainCookie = cookiesOf(await post('/sign-in/email', { email: 'plain-lecturer@example.com', password: PASSWORD }))
    const query = await authorizeToConsent(auth, { clientId, cookie: plainCookie })
    const allow = await post('/oauth2/consent', { accept: true, oauth_query: query }, plainCookie)
    expect(allow.status).toBe(403)
  })
})
