import { eq } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { config, setConfigForTests } from '@/server/core/config'
import type { Db } from '@/server/db'
import { user } from '@/server/db/schema'
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

  it('still rejects an admin role at sign-up', async () => {
    const res = await post(
      '/sign-up/email',
      { name: 'X', email: 'x@example.com', password: 'correct-horse-9', role: 'admin' },
      false,
    )
    expect(res.status).toBe(400)
  })
})
