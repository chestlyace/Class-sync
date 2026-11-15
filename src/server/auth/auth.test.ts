import { eq } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { config, setConfigForTests } from '@/server/core/config'
import type { Db } from '@/server/db'
import { session, user } from '@/server/db/schema'
import { createTestDb } from '@/test/db'
import { createAuth } from './auth'

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
