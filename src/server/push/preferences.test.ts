import { afterEach, beforeAll, describe, expect, it } from 'vitest'
import type { Db } from '@/server/db'
import { notificationPreference } from '@/server/db/schema'
import { createTestDb } from '@/test/db'
import { ctxFor, makeUser } from '@/test/factories'
import { getClassReminders, setClassReminders } from './preferences'

describe('class reminder preference', () => {
  let db: Db
  beforeAll(async () => {
    db = await createTestDb()
  })
  afterEach(async () => {
    await db.delete(notificationPreference)
  })

  it('defaults to on', async () => {
    const student = ctxFor(db, await makeUser(db, { role: 'student' }))
    expect(await getClassReminders(student)).toBe(true)
  })

  it('a student can turn class reminders off', async () => {
    const student = ctxFor(db, await makeUser(db, { role: 'student' }))
    await setClassReminders(student, false)
    expect(await getClassReminders(student)).toBe(false)
    await setClassReminders(student, true)
    expect(await getClassReminders(student)).toBe(true)
    expect(await db.select().from(notificationPreference)).toHaveLength(1)
  })

  it('a lecturer cannot', async () => {
    const lecturer = ctxFor(db, await makeUser(db, { role: 'lecturer' }))
    await expect(setClassReminders(lecturer, false)).rejects.toMatchObject({ code: 'FORBIDDEN' })
    expect(await getClassReminders(lecturer)).toBe(true)
  })
})
