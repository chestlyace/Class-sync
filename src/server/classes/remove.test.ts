import { eq } from 'drizzle-orm'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import type { Db } from '@/server/db'
import { assignment, class_, classLecturer, classStudent, course, file, school } from '@/server/db/schema'
import { createTestDb } from '@/test/db'
import { ctxFor, makeUser } from '@/test/factories'
import { createSchool } from '@/server/schools/service'
import { createCourse, listLecturerCourses, listStudentCourses } from '@/server/courses/service'
import { createClass, joinClassAsLecturer, joinClassAsStudent, listMyClasses } from './service'
import { getClassRemoval, removeClass } from './remove'

vi.mock('@/server/files/storage', () => ({ getStorage: () => ({ remove: async () => {} }) }))
vi.mock('@/server/push/send', () => ({
  sendPush: vi.fn(async () => ({ sent: 0, skipped: 0, failed: 0, removed: 0 })),
  queuePush: vi.fn(async () => {}),
}))

describe('removing a class', () => {
  let db: Db

  beforeAll(async () => {
    db = await createTestDb()
  })
  afterEach(async () => {
    await db.delete(file)
    await db.delete(course)
    await db.delete(classStudent)
    await db.delete(classLecturer)
    await db.delete(class_)
    await db.delete(school)
  })

  async function lecturerCtx() {
    return ctxFor(db, await makeUser(db, { role: 'lecturer' }))
  }

  /** A class with one student and my course; `withColleague` adds a second lecturer with a course. */
  async function setup({ withColleague }: { withColleague: boolean }) {
    const me = await lecturerCtx()
    const sch = await createSchool(me, { name: 'University of Buea', town: 'Buea' })
    const cls = await createClass(me, { schoolId: sch.id, name: 'CS L3', academicYear: '2026/27' })
    const student = ctxFor(db, await makeUser(db, { role: 'student' }))
    await joinClassAsStudent(student, cls.studentCode!, 'UB26-001')
    const mine = await createCourse(me, { classId: cls.id, title: 'Algorithms', semester: 1 })
    await db
      .insert(assignment)
      .values({ courseId: mine.id, title: 'Essay', dueAt: new Date(), maxMark: 20, submissionMode: 'text', createdBy: me.user.id })
    const colleague = await lecturerCtx()
    let theirs: { id: string } | undefined
    if (withColleague) {
      await joinClassAsLecturer(colleague, cls.lecturerCode!)
      theirs = await createCourse(colleague, { classId: cls.id, title: 'Networks', semester: 1 })
    }
    return { me, colleague, student, cls, mine, theirs }
  }

  it('the only lecturer deletes the class: its courses and students go with it', async () => {
    const { me, student, cls, mine } = await setup({ withColleague: false })
    expect(await getClassRemoval(me, cls.id)).toEqual({
      mode: 'delete',
      impact: expect.objectContaining({ courses: 1, students: 1, assignments: 1 }),
    })

    expect(await removeClass(me, cls.id, 'cs l3', 'delete')).toEqual({ mode: 'delete' })

    expect(await db.select().from(class_).where(eq(class_.id, cls.id))).toEqual([])
    expect(await db.select().from(course).where(eq(course.id, mine.id))).toEqual([])
    expect(await db.select().from(classStudent).where(eq(classStudent.classId, cls.id))).toEqual([])
    expect(await listMyClasses(student)).toEqual([])
    expect(await listStudentCourses(student)).toEqual([])
  })

  it('with a colleague in the class, I leave: my courses go, the class, its students and their courses stay', async () => {
    const { me, colleague, student, cls, mine, theirs } = await setup({ withColleague: true })
    expect(await getClassRemoval(me, cls.id)).toEqual({
      mode: 'leave',
      impact: expect.objectContaining({ courses: 1, students: null, assignments: 1 }),
    })

    expect(await removeClass(me, cls.id, 'CS L3', 'leave')).toEqual({ mode: 'leave' })

    expect(await db.select().from(course).where(eq(course.id, mine.id))).toEqual([])
    expect(await listMyClasses(me)).toEqual([])
    expect(await listLecturerCourses(me)).toEqual([])
    expect((await listMyClasses(colleague)).map((c) => c.id)).toEqual([cls.id])
    expect((await listMyClasses(student)).map((c) => c.id)).toEqual([cls.id])
    expect((await listStudentCourses(student)).map((c) => c.id)).toEqual([theirs!.id])
  })

  it('once the colleague is the last lecturer, removing the class deletes it', async () => {
    const { me, colleague, cls } = await setup({ withColleague: true })
    await removeClass(me, cls.id, 'CS L3', 'leave')
    expect((await getClassRemoval(colleague, cls.id)).mode).toBe('delete')
    expect(await removeClass(colleague, cls.id, 'CS L3', 'delete')).toEqual({ mode: 'delete' })
    expect(await db.select().from(class_).where(eq(class_.id, cls.id))).toEqual([])
  })

  it('a page that still says "leave" after the colleague left is CONFLICT and deletes nothing', async () => {
    const { me, colleague, student, cls } = await setup({ withColleague: true })
    await removeClass(colleague, cls.id, 'CS L3', 'leave')
    await expect(removeClass(me, cls.id, 'CS L3', 'leave')).rejects.toMatchObject({ code: 'CONFLICT' })
    expect(await db.select().from(class_).where(eq(class_.id, cls.id))).toHaveLength(1)
    expect((await listMyClasses(student)).map((c) => c.id)).toEqual([cls.id])
  })

  it('a wrong confirmation is VALIDATION on the confirm field and changes nothing', async () => {
    const { me, cls, mine } = await setup({ withColleague: false })
    await expect(removeClass(me, cls.id, 'CS L', 'delete')).rejects.toMatchObject({ code: 'VALIDATION', details: { fields: ['confirm'] } })
    expect(await db.select().from(course).where(eq(course.id, mine.id))).toHaveLength(1)
    expect(await db.select().from(class_).where(eq(class_.id, cls.id))).toHaveLength(1)
  })

  it('a student and an outsider lecturer are FORBIDDEN', async () => {
    const { student, cls } = await setup({ withColleague: false })
    for (const ctx of [student, await lecturerCtx()]) {
      await expect(removeClass(ctx, cls.id, 'CS L3', 'delete')).rejects.toMatchObject({ code: 'FORBIDDEN' })
      await expect(getClassRemoval(ctx, cls.id)).rejects.toMatchObject({ code: 'FORBIDDEN' })
    }
    expect(await db.select().from(class_).where(eq(class_.id, cls.id))).toHaveLength(1)
  })
})
