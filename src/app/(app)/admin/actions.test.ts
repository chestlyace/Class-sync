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

import { getSchoolDetail, listSchools } from '@/server/admin/schools'
import { createSchool } from '@/server/schools/service'
import {
  deleteSchoolAdminAction,
  mergeSchoolsAdminAction,
  resendVerificationAction,
  revokeSessionsAction,
  searchSchoolsForMergeAction,
  suspendAction,
  unsuspendAction,
  updateSchoolAdminAction,
} from './actions'

function form(fields: Record<string, string>): FormData {
  const data = new FormData()
  for (const [k, v] of Object.entries(fields)) data.set(k, v)
  return data
}

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
    const audit = (await listAudit(admin, 1)).rows.filter((r) => r.target.kind === 'user' && r.target.email === person.email)
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

  it('refuses a signed-out caller with NOT_FOUND too', async () => {
    const target = await makeUser(db)
    for (const action of [suspendAction, unsuspendAction, revokeSessionsAction, resendVerificationAction]) {
      expect(await action(target.id, '')).toEqual({ ok: false, code: 'NOT_FOUND' })
    }
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

  it('signing yourself out everywhere sends you to sign-in, after the revoke', async () => {
    const admin = await makeAdmin()
    current = admin
    await expect(revokeSessionsAction(admin.user.id, '')).rejects.toMatchObject({
      digest: expect.stringMatching(/^NEXT_REDIRECT;\w+;\/sign-in;/),
    })
    expect((await inspect(admin, admin.user.id)).audit).toMatchObject([{ action: 'revoke_sessions' }])
  })

  it('signing someone else out everywhere stays on their page', async () => {
    const admin = await makeAdmin()
    const target = await makeUser(db)
    current = admin
    expect(await revokeSessionsAction(target.id, '')).toEqual({ ok: true, data: null })
    expect(revalidatePath).toHaveBeenCalledWith(`/admin/people/${target.id}`)
  })

  it('passes service refusals through as results', async () => {
    const admin = await makeAdmin()
    current = admin

    expect(await suspendAction(admin.user.id, '')).toEqual({ ok: false, code: 'FORBIDDEN' })
    expect(await unsuspendAction(crypto.randomUUID(), '')).toEqual({ ok: false, code: 'NOT_FOUND' })
    expect(await suspendAction(42 as unknown as string, '')).toMatchObject({ ok: false, code: 'VALIDATION' })
    expect(revalidatePath).not.toHaveBeenCalled()
  })

  describe('schools', () => {
    async function twoSchools() {
      const lecturer = ctxFor(db, await makeUser(db, { role: 'lecturer' }))
      const tag = crypto.randomUUID().slice(0, 6)
      const kept = await createSchool(lecturer, { name: `IUT ${tag}`, town: 'Douala' })
      const dup = await createSchool(lecturer, { name: `I.U.T. ${tag}`, town: 'Douala' })
      return { kept, dup, tag }
    }

    it('refuses a non-admin with NOT_FOUND from every school action, before reading the input', async () => {
      const { kept, dup } = await twoSchools()
      current = ctxFor(db, await makeUser(db))
      const update = form({ schoolId: kept.id, name: 'Renamed School', town: 'Douala' })
      expect(await updateSchoolAdminAction(null, update)).toEqual({ ok: false, code: 'NOT_FOUND' })
      expect(await deleteSchoolAdminAction(null, form({ schoolId: kept.id, confirm: kept.name }))).toEqual({ ok: false, code: 'NOT_FOUND' })
      expect(await mergeSchoolsAdminAction(null, form({ fromId: dup.id, intoId: kept.id }))).toEqual({ ok: false, code: 'NOT_FOUND' })
      expect(await updateSchoolAdminAction(null, form({}))).toEqual({ ok: false, code: 'NOT_FOUND' })
      expect(await searchSchoolsForMergeAction('iut', kept.id)).toEqual({ ok: false, code: 'NOT_FOUND' })
      expect(revalidatePath).not.toHaveBeenCalled()
    })

    it('renames a school and refreshes the list and its page', async () => {
      const admin = await makeAdmin()
      const { kept } = await twoSchools()
      current = admin
      const result = await updateSchoolAdminAction(null, form({ schoolId: kept.id, name: 'IUT de Douala', town: 'Douala', reason: 'typo' }))
      expect(result).toEqual({ ok: true, data: null })
      expect((await getSchoolDetail(admin, kept.id)).name).toBe('IUT de Douala')
      expect(revalidatePath).toHaveBeenCalledWith('/admin/schools')
      expect(revalidatePath).toHaveBeenCalledWith(`/admin/schools/${kept.id}`)
    })

    it('passes a name clash through with the other school, and a missing id as VALIDATION', async () => {
      const admin = await makeAdmin()
      const { kept, dup } = await twoSchools()
      current = admin
      expect(await updateSchoolAdminAction(null, form({ schoolId: dup.id, name: kept.name, town: 'douala' }))).toEqual({
        ok: false,
        code: 'CONFLICT',
        details: { existingSchoolId: kept.id },
      })
      expect(await updateSchoolAdminAction(null, form({ name: 'Some School', town: 'Douala' }))).toMatchObject({
        ok: false,
        code: 'VALIDATION',
      })
    })

    it('finds schools to merge with', async () => {
      const admin = await makeAdmin()
      const { kept, dup, tag } = await twoSchools()
      current = admin
      const result = await searchSchoolsForMergeAction(tag, kept.id)
      expect(result).toMatchObject({ ok: true, data: [{ id: dup.id }] })
    })

    it('merges and goes to the kept school', async () => {
      const admin = await makeAdmin()
      const { kept, dup } = await twoSchools()
      current = admin
      await expect(mergeSchoolsAdminAction(null, form({ fromId: dup.id, intoId: kept.id }))).rejects.toMatchObject({
        digest: expect.stringMatching(new RegExp(`^NEXT_REDIRECT;\\w+;/admin/schools/${kept.id};`)),
      })
      await expect(getSchoolDetail(admin, dup.id)).rejects.toMatchObject({ code: 'NOT_FOUND' })
    })

    it('deletes and goes back to the list; a wrong name is VALIDATION', async () => {
      const admin = await makeAdmin()
      const { kept } = await twoSchools()
      current = admin
      expect(await deleteSchoolAdminAction(null, form({ schoolId: kept.id, confirm: 'nope' }))).toMatchObject({
        ok: false,
        code: 'VALIDATION',
      })
      await expect(deleteSchoolAdminAction(null, form({ schoolId: kept.id, confirm: kept.name }))).rejects.toMatchObject({
        digest: expect.stringMatching(/^NEXT_REDIRECT;\w+;\/admin\/schools;/),
      })
      expect((await listSchools(admin, { search: kept.name, page: 1 })).rows).toEqual([])
    })
  })
})
