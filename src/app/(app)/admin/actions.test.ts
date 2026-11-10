import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { getPerson, listAudit } from '@/server/admin/queries'
import type { Ctx } from '@/server/core/context'
import { AppError } from '@/server/core/errors'
import { createTestDb } from '@/test/db'
import { ctxFor, makeUser } from '@/test/factories'

let current: Ctx | null = null
vi.mock('@/server/auth/session', () => ({
  getCtx: async () => {
    if (!current) throw new AppError('UNAUTHENTICATED', 'Not signed in')
    return current
  },
}))
const revalidatePath = vi.fn()
vi.mock('next/cache', () => ({ revalidatePath: (path: string) => revalidatePath(path) }))

import { resendVerificationAction, revokeSessionsAction, suspendAction, unsuspendAction } from './actions'

// UI code doesn't import the database layer (eslint), so the checks below read through the admin
// read models, as an admin.
describe('admin Server Actions', () => {
  let db: Awaited<ReturnType<typeof createTestDb>>

  beforeAll(async () => {
    db = await createTestDb()
  })
  beforeEach(() => revalidatePath.mockReset())
  afterEach(() => {
    current = null
    vi.unstubAllEnvs()
  })

  async function makeAdmin() {
    const admin = await makeUser(db, { email: `admin-${crypto.randomUUID().slice(0, 8)}@example.com` })
    vi.stubEnv('ADMIN_EMAILS', admin.email)
    return ctxFor(db, admin)
  }
  /** Reads the person and their audit entries as `admin` (the read models are admin-only). */
  async function inspect(admin: Ctx, id: string) {
    const person = await getPerson(admin, id)
    const audit = (await listAudit(admin, 1)).rows.filter((r) => r.targetEmail === person.email)
    return { person, audit }
  }

  it('refuses a non-admin with NOT_FOUND from every action and changes nothing', async () => {
    const admin = await makeAdmin()
    const nobody = await makeUser(db)
    const target = await makeUser(db, { emailVerified: false })
    current = ctxFor(db, nobody)

    for (const action of [suspendAction, unsuspendAction, revokeSessionsAction, resendVerificationAction]) {
      expect(await action(target.id, 'because')).toEqual({ ok: false, code: 'NOT_FOUND' })
    }
    // Even malformed input says nothing more than NOT_FOUND.
    expect(await suspendAction(42 as unknown as string)).toEqual({ ok: false, code: 'NOT_FOUND' })
    const { person, audit } = await inspect(admin, target.id)
    expect(person.suspendedAt).toBeNull()
    expect(audit).toHaveLength(0)
    expect(revalidatePath).not.toHaveBeenCalled()
  })

  it('refuses a signed-out caller', async () => {
    const target = await makeUser(db)
    expect(await suspendAction(target.id, '')).toEqual({ ok: false, code: 'UNAUTHENTICATED' })
  })

  it('lets an admin suspend a user, with the reason, and refreshes the person page', async () => {
    const admin = await makeAdmin()
    const target = await makeUser(db)
    current = admin

    expect(await suspendAction(target.id, 'spam')).toEqual({ ok: true, data: null })
    const after = await inspect(admin, target.id)
    expect(after.person.suspendedAt).toBeInstanceOf(Date)
    expect(after.person.suspendedReason).toBe('spam')
    expect(after.audit).toMatchObject([{ action: 'suspend', reason: 'spam' }])
    expect(revalidatePath).toHaveBeenCalledWith(`/admin/people/${target.id}`)

    expect(await unsuspendAction(target.id, '')).toEqual({ ok: true, data: null })
    expect((await inspect(admin, target.id)).person.suspendedAt).toBeNull()
  })

  it('passes service refusals through as results', async () => {
    const admin = await makeAdmin()
    current = admin

    expect(await suspendAction(admin.user.id, '')).toEqual({ ok: false, code: 'FORBIDDEN' })
    expect(await unsuspendAction(crypto.randomUUID(), '')).toEqual({ ok: false, code: 'NOT_FOUND' })
    expect(await suspendAction(42 as unknown as string, '')).toMatchObject({ ok: false, code: 'VALIDATION' })
    expect(revalidatePath).not.toHaveBeenCalled()
  })
})
