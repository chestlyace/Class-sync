import { eq } from 'drizzle-orm'
import { afterEach, beforeAll, describe, expect, it } from 'vitest'
import { config, setConfigForTests } from '@/server/core/config'
import type { Db } from '@/server/db'
import { class_, classLecturer, classStudent, course, courseRosterAdjustment, school } from '@/server/db/schema'
import { createTestDb } from '@/test/db'
import { ctxFor, makeUser } from '@/test/factories'
import { createClass, joinClassAsLecturer, joinClassAsStudent, removeStudentFromClass } from '@/server/classes/service'
import { createCourse } from '@/server/courses/service'
import { createSchool } from '@/server/schools/service'
import { getOnboardingStatus } from './service'

describe('onboarding service', () => {
  let db: Db
  const original = config.requireEmailVerification

  beforeAll(async () => {
    db = await createTestDb()
  })
  afterEach(async () => {
    setConfigForTests({ requireEmailVerification: original })
    await db.delete(courseRosterAdjustment)
    await db.delete(course)
    await db.delete(classStudent)
    await db.delete(classLecturer)
    await db.delete(class_)
    await db.delete(school)
  })

  async function lecturerCtx() {
    return ctxFor(db, await makeUser(db, { role: 'lecturer' }))
  }
  async function studentCtx() {
    return ctxFor(db, await makeUser(db, { role: 'student' }))
  }

  it('a new lecturer has every step to do', async () => {
    const lecturer = await lecturerCtx()
    expect(await getOnboardingStatus(lecturer)).toEqual({
      role: 'lecturer',
      steps: { school: false, class: false, course: false, share: false },
      latestSchoolId: null,
      latestClass: null,
      complete: false,
    })
  })

  it('ticks the steps off as the lecturer goes', async () => {
    const lecturer = await lecturerCtx()
    const sch = await createSchool(lecturer, { name: 'University of Buea', town: 'Buea' })
    let status = await getOnboardingStatus(lecturer)
    expect(status).toMatchObject({
      steps: { school: true, class: false, course: false, share: false },
      latestSchoolId: sch.id,
    })

    const cls = await createClass(lecturer, { schoolId: sch.id, name: 'CS L3', academicYear: '2026/27' })
    status = await getOnboardingStatus(lecturer)
    expect(status).toMatchObject({
      steps: { school: true, class: true, course: false, share: false },
      latestClass: { id: cls.id, name: 'CS L3', studentCode: cls.studentCode },
    })

    await createCourse(lecturer, { classId: cls.id, title: 'Algorithms', semester: 1 })
    status = await getOnboardingStatus(lecturer)
    expect(status).toMatchObject({ steps: { course: true, share: false }, complete: false })

    await joinClassAsStudent(await studentCtx(), cls.studentCode!, 'UB24-001')
    status = await getOnboardingStatus(lecturer)
    expect(status).toMatchObject({
      steps: { school: true, class: true, course: true, share: true },
      complete: true,
    })
  })

  it('counts a school picked through a class, and a class joined with a lecturer code', async () => {
    const owner = await lecturerCtx()
    const sch = await createSchool(owner, { name: 'UB', town: 'Buea' })
    const cls = await createClass(owner, { schoolId: sch.id, name: 'Maths L1', academicYear: '2026/27' })

    const colleague = await lecturerCtx()
    await joinClassAsLecturer(colleague, cls.lecturerCode!)
    expect(await getOnboardingStatus(colleague)).toMatchObject({
      steps: { school: true, class: true, course: false, share: false },
      latestSchoolId: null,
      latestClass: { id: cls.id },
    })
  })

  it('picks the most recent class for sharing', async () => {
    const lecturer = await lecturerCtx()
    const sch = await createSchool(lecturer, { name: 'UB', town: 'Buea' })
    const older = await createClass(lecturer, { schoolId: sch.id, name: 'Older', academicYear: '2026/27' })
    await db.update(class_).set({ createdAt: new Date('2026-01-01T00:00:00Z') }).where(eq(class_.id, older.id))
    const newer = await createClass(lecturer, { schoolId: sch.id, name: 'Newer', academicYear: '2026/27' })
    expect(await getOnboardingStatus(lecturer)).toMatchObject({ latestClass: { id: newer.id, name: 'Newer' } })
  })

  it('a removed student does not count as shared, nor does a student in someone else’s class', async () => {
    const lecturer = await lecturerCtx()
    const sch = await createSchool(lecturer, { name: 'UB', town: 'Buea' })
    const mine = await createClass(lecturer, { schoolId: sch.id, name: 'Mine', academicYear: '2026/27' })

    const other = await lecturerCtx()
    const theirs = await createClass(other, { schoolId: sch.id, name: 'Theirs', academicYear: '2026/27' })
    await joinClassAsStudent(await studentCtx(), theirs.studentCode!, 'UB24-100')

    const student = await studentCtx()
    await joinClassAsStudent(student, mine.studentCode!, 'UB24-001')
    await removeStudentFromClass(lecturer, mine.id, student.user.id)

    expect(await getOnboardingStatus(lecturer)).toMatchObject({ steps: { share: false } })
  })

  it('a student is done once they are in a class', async () => {
    const lecturer = await lecturerCtx()
    const sch = await createSchool(lecturer, { name: 'UB', town: 'Buea' })
    const cls = await createClass(lecturer, { schoolId: sch.id, name: 'CS', academicYear: '2026/27' })
    const student = await studentCtx()

    expect(await getOnboardingStatus(student)).toEqual({ role: 'student', steps: { join: false }, complete: false })
    await joinClassAsStudent(student, cls.studentCode!, 'UB24-001')
    expect(await getOnboardingStatus(student)).toEqual({ role: 'student', steps: { join: true }, complete: true })

    await removeStudentFromClass(lecturer, cls.id, student.user.id)
    expect(await getOnboardingStatus(student)).toMatchObject({ steps: { join: false } })
  })

  it('refuses an unverified user when verification is required', async () => {
    setConfigForTests({ requireEmailVerification: true })
    const ctx = ctxFor(db, await makeUser(db, { role: 'lecturer', emailVerified: false }))
    await expect(getOnboardingStatus(ctx)).rejects.toMatchObject({ code: 'EMAIL_UNVERIFIED' })
  })
})
