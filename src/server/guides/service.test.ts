import { afterEach, beforeAll, describe, expect, it } from 'vitest'
import type { Db } from '@/server/db'
import { user, userGuideSeen } from '@/server/db/schema'
import { createTestDb } from '@/test/db'
import { ctxFor, makeUser } from '@/test/factories'
import { listSeenGuides, markGuideSeen } from './service'

describe('seen guides', () => {
  let db: Db

  beforeAll(async () => {
    db = await createTestDb()
  })
  afterEach(async () => {
    await db.delete(userGuideSeen)
    await db.delete(user)
  })

  it('remembers a guide once per account, whatever the device', async () => {
    const lecturer = ctxFor(db, await makeUser(db, { role: 'lecturer' }))
    expect(await listSeenGuides(lecturer)).toEqual([])
    await markGuideSeen(lecturer, 'lecturerWelcome')
    // Seeing it again (another device, a replay) changes nothing.
    await markGuideSeen(lecturer, 'lecturerWelcome')
    await markGuideSeen(lecturer, 'tests')
    expect((await listSeenGuides(lecturer)).sort()).toEqual(['lecturerWelcome', 'tests'])
  })

  it("keeps each account's guides apart", async () => {
    const a = ctxFor(db, await makeUser(db, { role: 'student' }))
    const b = ctxFor(db, await makeUser(db, { role: 'student' }))
    await markGuideSeen(a, 'studentWelcome')
    expect(await listSeenGuides(b)).toEqual([])
  })

  it("refuses an unknown guide, or one of the other role's", async () => {
    const student = ctxFor(db, await makeUser(db, { role: 'student' }))
    for (const id of ['nope', 'lecturerWelcome', 42, null]) {
      await expect(markGuideSeen(student, id)).rejects.toMatchObject({ code: 'VALIDATION' })
    }
    expect(await listSeenGuides(student)).toEqual([])
  })
})
