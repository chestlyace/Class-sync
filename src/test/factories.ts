import type { Ctx, SessionUser } from '@/server/core/context'
import type { Db } from '@/server/db'
import { user } from '@/server/db/schema'

let counter = 0

/** Inserts a user row directly (no Better Auth) and returns it as a SessionUser. */
export async function makeUser(db: Db, overrides: Partial<SessionUser> = {}): Promise<SessionUser> {
  counter += 1
  const u: SessionUser = {
    id: crypto.randomUUID(),
    name: `Test User ${counter}`,
    email: `user${counter}-${crypto.randomUUID().slice(0, 8)}@example.com`,
    role: 'lecturer',
    locale: 'en',
    emailVerified: true,
    ...overrides,
  }
  await db.insert(user).values(u)
  return u
}

export function ctxFor(db: Db, user: SessionUser): Ctx {
  return { db, user }
}
