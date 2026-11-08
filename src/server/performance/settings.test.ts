import { eq } from 'drizzle-orm'
import { afterEach, beforeAll, describe, expect, it } from 'vitest'
import { setNowForTests } from '@/server/core/clock'
import type { Db } from '@/server/db'
import { class_, classLecturer, classStudent, course, courseCaSettings, school } from '@/server/db/schema'
import { createTestDb } from '@/test/db'
import { ctxFor, makeUser } from '@/test/factories'
import { createSchool } from '@/server/schools/service'
import { createClass, joinClassAsLecturer, joinClassAsStudent } from '@/server/classes/service'
import { createCourse } from '@/server/courses/service'
import { DEFAULT_SETTINGS } from './rules'
import { updateCaSettings } from './settings'

describe('CA settings', () => {
  let db: Db

  beforeAll(async () => {
    db = await createTestDb()
  })
  afterEach(async () => {
    setNowForTests(null)
    await db.delete(courseCaSettings)
    await db.delete(course)
    await db.delete(classStudent)
    await db.delete(classLecturer)
    await db.delete(class_)
    await db.delete(school)
  })

  async function setup() {
    const lecturer = ctxFor(db, await makeUser(db, { role: 'lecturer' }))
    const sch = await createSchool(lecturer, { name: 'University of Buea', town: 'Buea' })
    const cls = await createClass(lecturer, { schoolId: sch.id, name: 'CS L3', academicYear: '2026/27' })
    const colleague = ctxFor(db, await makeUser(db, { role: 'lecturer' }))
    await joinClassAsLecturer(colleague, cls.lecturerCode!)
    const algo = await createCourse(lecturer, { classId: cls.id, title: 'Algorithms', semester: 1 })
    const student = ctxFor(db, await makeUser(db, { role: 'student' }))
    await joinClassAsStudent(student, cls.studentCode!, 'UB1')
    return { lecturer, colleague, student, algo }
  }

  const stored = (courseId: string) =>
    db.select().from(courseCaSettings).where(eq(courseCaSettings.courseId, courseId))

  it('stores valid settings, returns them and records who and when', async () => {
    const { lecturer, algo } = await setup()
    const at = new Date('2026-11-08T10:00:00Z')
    setNowForTests(() => at)
    const input = { ...DEFAULT_SETTINGS, total: 20, attendancePoints: 5, assignmentPoints: 10, participationPoints: 5 }
    expect(await updateCaSettings(lecturer, algo.id, input)).toEqual(input)
    const [row] = await stored(algo.id)
    expect(row).toMatchObject({ ...input, updatedBy: lecturer.user.id, updatedAt: at })

    // A second save replaces the row (upsert) and moves updatedAt.
    const later = new Date('2026-11-09T10:00:00Z')
    setNowForTests(() => later)
    const again = { ...DEFAULT_SETTINGS, participationTarget: 8 }
    expect(await updateCaSettings(lecturer, algo.id, again)).toEqual(again)
    const rows = await stored(algo.id)
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ ...again, updatedAt: later })
  })

  it('keeps two-decimal points exactly', async () => {
    const { lecturer, algo } = await setup()
    const input = { ...DEFAULT_SETTINGS, total: 30, attendancePoints: 2.5, assignmentPoints: 22.5, participationPoints: 5 }
    expect(await updateCaSettings(lecturer, algo.id, input)).toEqual(input)
    expect((await stored(algo.id))[0]).toMatchObject({ attendancePoints: 2.5, assignmentPoints: 22.5 })
  })

  it('refuses parts that do not add up to the total and stores nothing (10 + 10 + 5 for 30)', async () => {
    const { lecturer, algo } = await setup()
    const bad = { ...DEFAULT_SETTINGS, attendancePoints: 10, assignmentPoints: 10, participationPoints: 5 }
    await expect(updateCaSettings(lecturer, algo.id, bad)).rejects.toMatchObject({
      code: 'VALIDATION',
      details: { reason: 'sum' },
    })
    expect(await stored(algo.id)).toHaveLength(0)
  })

  it('maps the other validation errors to their reason', async () => {
    const { lecturer, algo } = await setup()
    await expect(updateCaSettings(lecturer, algo.id, { ...DEFAULT_SETTINGS, total: 0 })).rejects.toMatchObject({
      code: 'VALIDATION',
      details: { reason: 'range' },
    })
    await expect(updateCaSettings(lecturer, algo.id, { ...DEFAULT_SETTINGS, attendancePoints: 5.005 })).rejects.toMatchObject({
      details: { reason: 'decimals' },
    })
    await expect(updateCaSettings(lecturer, algo.id, 'nope')).rejects.toMatchObject({
      details: { reason: 'shape' },
    })
    expect(await stored(algo.id)).toHaveLength(0)
  })

  it('saves test points and the best-of', async () => {
    const { lecturer, algo } = await setup()
    const withTests = { ...DEFAULT_SETTINGS, assignmentPoints: 15, testPoints: 5, testsBestOf: 3 }
    expect(await updateCaSettings(lecturer, algo.id, withTests)).toEqual(withTests)
    expect((await stored(algo.id))[0]).toMatchObject({ testPoints: 5, testsBestOf: 3 })

    // Back to every test.
    const all = { ...withTests, testsBestOf: null }
    expect(await updateCaSettings(lecturer, algo.id, all)).toEqual(all)
    expect((await stored(algo.id))[0].testsBestOf).toBeNull()
  })

  it('refuses a best-of out of range and stores nothing', async () => {
    const { lecturer, algo } = await setup()
    await expect(updateCaSettings(lecturer, algo.id, { ...DEFAULT_SETTINGS, testsBestOf: 0 })).rejects.toMatchObject({
      code: 'VALIDATION',
      details: { reason: 'range' },
    })
    expect(await stored(algo.id)).toHaveLength(0)
  })

  it('treats test points below a cent as 0 and stores 0', async () => {
    const { lecturer, algo } = await setup()
    const result = await updateCaSettings(lecturer, algo.id, { ...DEFAULT_SETTINGS, testPoints: 1e-9 })
    expect(result).toEqual(DEFAULT_SETTINGS)
    expect((await stored(algo.id))[0].testPoints).toBe(0)
  })

  it('is owner only: colleague, student and a missing course are FORBIDDEN', async () => {
    const { colleague, student, algo, lecturer } = await setup()
    for (const ctx of [colleague, student]) {
      await expect(updateCaSettings(ctx, algo.id, DEFAULT_SETTINGS)).rejects.toMatchObject({ code: 'FORBIDDEN' })
    }
    await expect(updateCaSettings(lecturer, 'missing', DEFAULT_SETTINGS)).rejects.toMatchObject({ code: 'FORBIDDEN' })
    expect(await stored(algo.id)).toHaveLength(0)
  })
})
