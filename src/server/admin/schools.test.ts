import { eq } from 'drizzle-orm'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Ctx } from '@/server/core/context'
import type { Db } from '@/server/db'
import {
  adminAction,
  class_,
  classLecturer,
  classStudent,
  course,
  courseTopic,
  file,
  resource,
  resourcePlacement,
  school,
  user,
} from '@/server/db/schema'
import { createTestDb } from '@/test/db'
import { ctxFor, makeUser } from '@/test/factories'
import { createClass, joinClassAsLecturer, joinClassAsStudent } from '@/server/classes/service'
import { createCourse } from '@/server/courses/service'
import { createSchool, setSchoolLocation } from '@/server/schools/service'
import {
  adminDeleteSchool,
  adminUpdateSchool,
  getSchoolDeletion,
  getSchoolDetail,
  listSchools,
  mergeSchools,
  searchSchoolsForMerge,
} from './schools'

vi.mock('@/server/files/storage', () => ({ getStorage: () => ({ remove: async () => {} }) }))
vi.mock('@/server/push/send', () => ({
  sendPush: vi.fn(async () => ({ sent: 0, skipped: 0, failed: 0, removed: 0 })),
  queuePush: vi.fn(async () => {}),
}))

describe('admin schools', () => {
  let db: Db
  let admin: Ctx
  let lecA: Ctx
  let lecB: Ctx
  let fx: Awaited<ReturnType<typeof setup>>

  beforeAll(async () => {
    db = await createTestDb()
  })
  beforeEach(async () => {
    const adminUser = await makeUser(db, { name: 'Dr Admin', email: `admin-${crypto.randomUUID().slice(0, 8)}@example.com` })
    vi.stubEnv('ADMIN_EMAILS', adminUser.email)
    admin = ctxFor(db, adminUser)
    lecA = ctxFor(db, await makeUser(db, { name: 'Lecturer A', role: 'lecturer' }))
    lecB = ctxFor(db, await makeUser(db, { name: 'Lecturer B', role: 'lecturer' }))
    fx = await setup()
  })
  afterEach(async () => {
    vi.unstubAllEnvs()
    await db.delete(adminAction)
    await db.delete(resource)
    await db.delete(file)
    await db.delete(course)
    await db.delete(classStudent)
    await db.delete(classLecturer)
    await db.delete(class_)
    await db.delete(school)
  })

  /**
   * Lycée Bilingue (Buea, no classes); IUT (Douala) with two classes: c1 (A) and c2 (A and B),
   * students s1 (c1), s2 (c1, c2), s3 (c2), s4 (c2, removed); one course each; ENSET (Douala, empty).
   */
  async function setup() {
    const lycee = await createSchool(lecA, { name: 'Lycée Bilingue', town: 'Buea' })
    const iut = await createSchool(lecA, { name: 'IUT', town: 'Douala' })
    const enset = await createSchool(lecB, { name: 'ENSET', town: 'Douala' })
    const c1 = await createClass(lecA, { schoolId: iut.id, name: 'HND 1 SWE', academicYear: '2026/27' })
    const c2 = await createClass(lecA, { schoolId: iut.id, name: 'HND 2 SWE', academicYear: '2026/27' })
    await joinClassAsLecturer(lecB, c2.lecturerCode!)
    const students = await Promise.all(
      [1, 2, 3, 4].map(async (n) => ctxFor(db, await makeUser(db, { name: `Student ${n}`, role: 'student' }))),
    )
    await joinClassAsStudent(students[0], c1.studentCode!, 'S1')
    await joinClassAsStudent(students[1], c1.studentCode!, 'S2')
    await joinClassAsStudent(students[1], c2.studentCode!, 'S2')
    await joinClassAsStudent(students[2], c2.studentCode!, 'S3')
    await joinClassAsStudent(students[3], c2.studentCode!, 'S4')
    await db.update(classStudent).set({ status: 'removed' }).where(eq(classStudent.userId, students[3].user.id))
    const k1 = await createCourse(lecA, { classId: c1.id, title: 'Algorithms', semester: 1 })
    const k2 = await createCourse(lecB, { classId: c2.id, title: 'Databases', semester: 1 })
    return { lycee, iut, enset, c1, c2, k1, k2, students }
  }

  describe('reads', () => {
    it('gives a non-admin NOT_FOUND from every read', async () => {
      await expect(listSchools(lecA, { page: 1 })).rejects.toMatchObject({ code: 'NOT_FOUND' })
      await expect(getSchoolDetail(lecA, fx.iut.id)).rejects.toMatchObject({ code: 'NOT_FOUND' })
      await expect(searchSchoolsForMerge(lecA, 'iut', fx.enset.id)).rejects.toMatchObject({ code: 'NOT_FOUND' })
      await expect(getSchoolDeletion(lecA, fx.iut.id)).rejects.toMatchObject({ code: 'NOT_FOUND' })
    })

    it('lists schools by town then name, with classes, lecturers and active students', async () => {
      const page = await listSchools(admin, { page: 1 })
      expect(page.total).toBe(3)
      expect(page.rows.map((r) => r.name)).toEqual(['Lycée Bilingue', 'ENSET', 'IUT'])
      const iut = page.rows.find((r) => r.id === fx.iut.id)
      expect(iut).toMatchObject({ town: 'Douala', classes: 2, lecturers: 2, students: 3, hasLocation: false })
      expect(page.rows.find((r) => r.id === fx.enset.id)).toMatchObject({ classes: 0, lecturers: 0, students: 0 })
    })

    it('searches name or town, ignoring case and accents', async () => {
      expect((await listSchools(admin, { search: 'LYCEE', page: 1 })).rows.map((r) => r.name)).toEqual(['Lycée Bilingue'])
      expect((await listSchools(admin, { search: 'douala', page: 1 })).rows.map((r) => r.name)).toEqual(['ENSET', 'IUT'])
    })

    it('shows a school with its classes and the other schools in its town', async () => {
      const d = await getSchoolDetail(admin, fx.iut.id)
      expect(d).toMatchObject({ id: fx.iut.id, name: 'IUT', town: 'Douala', classes: 2, hasLocation: false })
      expect(d.creator).toEqual({ id: lecA.user.id, name: 'Lecturer A' })
      expect(d.classList).toEqual([
        {
          id: fx.c1.id,
          name: 'HND 1 SWE',
          academicYear: '2026/27',
          lecturers: [{ id: lecA.user.id, name: 'Lecturer A' }],
          students: 2,
          courses: 1,
        },
        {
          id: fx.c2.id,
          name: 'HND 2 SWE',
          academicYear: '2026/27',
          lecturers: [
            { id: lecA.user.id, name: 'Lecturer A' },
            { id: lecB.user.id, name: 'Lecturer B' },
          ],
          students: 2,
          courses: 1,
        },
      ])
      expect(d.sameTown).toEqual([expect.objectContaining({ id: fx.enset.id, name: 'ENSET', classes: 0 })])
    })

    it('shows a school with no classes, and NOT_FOUND for an unknown one', async () => {
      const d = await getSchoolDetail(admin, fx.lycee.id)
      expect(d.classList).toEqual([])
      expect(d.sameTown).toEqual([])
      await expect(getSchoolDetail(admin, 'nope')).rejects.toMatchObject({ code: 'NOT_FOUND' })
    })

    it('searches for a merge across towns, leaving out the school itself', async () => {
      expect(await searchSchoolsForMerge(admin, 'iut', fx.iut.id)).toEqual([])
      expect((await searchSchoolsForMerge(admin, 'douala', fx.iut.id)).map((s) => s.id)).toEqual([fx.enset.id])
      expect((await searchSchoolsForMerge(admin, 'buea', fx.iut.id)).map((s) => s.id)).toEqual([fx.lycee.id])
      expect(await searchSchoolsForMerge(admin, '  ', fx.iut.id)).toEqual([])
    })

    it('counts what deleting a school takes, across all its classes', async () => {
      const del = await getSchoolDeletion(admin, fx.iut.id)
      expect(del.classes).toBe(2)
      expect(del.impact).toMatchObject({ courses: 2, students: 3 })
      const empty = await getSchoolDeletion(admin, fx.enset.id)
      expect(empty).toMatchObject({ classes: 0, impact: { courses: 0, students: 0 } })
    })
  })

  describe('writes', () => {
    const audits = () => db.select().from(adminAction)
    const schoolRow = async (id: string) => (await db.select().from(school).where(eq(school.id, id)))[0]
    const ref = (s: { id: string; name: string; town: string }) => ({ id: s.id, name: s.name, town: s.town })

    /** A class at ENSET with one student and one course, so a merge has something to move. */
    async function ensetClass() {
      const cls = await createClass(lecB, { schoolId: fx.enset.id, name: 'BTS 1', academicYear: '2026/27' })
      await joinClassAsStudent(fx.students[0], cls.studentCode!, 'E1')
      const k = await createCourse(lecB, { classId: cls.id, title: 'Networks', semester: 1 })
      return { cls, k }
    }

    it('gives a non-admin NOT_FOUND from every write and changes nothing', async () => {
      await expect(adminUpdateSchool(lecA, fx.iut.id, { name: 'X School', town: 'Y' })).rejects.toMatchObject({ code: 'NOT_FOUND' })
      await expect(adminDeleteSchool(lecA, fx.iut.id, 'IUT')).rejects.toMatchObject({ code: 'NOT_FOUND' })
      await expect(mergeSchools(lecA, fx.enset.id, fx.iut.id)).rejects.toMatchObject({ code: 'NOT_FOUND' })
      expect(await db.select({ id: school.id }).from(school)).toHaveLength(3)
      expect((await schoolRow(fx.iut.id)).name).toBe('IUT')
      expect(await audits()).toEqual([])
    })

    it('updates name and town and audits before and after with the reason', async () => {
      await adminUpdateSchool(admin, fx.iut.id, { name: ' IUT Douala ', town: 'Douala' }, '  duplicate name  ')
      expect(await schoolRow(fx.iut.id)).toMatchObject({ name: 'IUT Douala', town: 'Douala', nameKey: 'iut douala', townKey: 'douala' })
      expect(await audits()).toEqual([
        expect.objectContaining({
          adminId: admin.user.id,
          action: 'school_update',
          targetUserId: null,
          targetSchoolId: fx.iut.id,
          reason: 'duplicate name',
          details: {
            kind: 'school_update',
            before: { name: 'IUT', town: 'Douala' },
            after: { name: 'IUT Douala', town: 'Douala' },
          },
        }),
      ])
    })

    it('refuses a name and town another school has, pointing at it', async () => {
      await expect(adminUpdateSchool(admin, fx.enset.id, { name: 'iut', town: 'DOUALA' })).rejects.toMatchObject({
        code: 'CONFLICT',
        details: { existingSchoolId: fx.iut.id },
      })
      await expect(adminUpdateSchool(admin, fx.enset.id, { name: 'I', town: 'Douala' })).rejects.toMatchObject({ code: 'VALIDATION' })
      await expect(adminUpdateSchool(admin, 'nope', { name: 'Some School', town: 'Douala' })).rejects.toMatchObject({ code: 'NOT_FOUND' })
      expect((await schoolRow(fx.enset.id)).name).toBe('ENSET')
      expect(await audits()).toEqual([])
    })

    it('deletes a school with its classes, courses and memberships, keeping every account', async () => {
      await adminDeleteSchool(admin, fx.iut.id, ' iut ', 'test school')
      expect(await schoolRow(fx.iut.id)).toBeUndefined()
      expect(await db.select().from(class_).where(eq(class_.schoolId, fx.iut.id))).toEqual([])
      expect(await db.select().from(classLecturer)).toEqual([])
      expect(await db.select().from(classStudent)).toEqual([])
      expect(await db.select().from(course)).toEqual([])
      const ids = [lecA.user.id, lecB.user.id, ...fx.students.map((s) => s.user.id)]
      expect((await db.select({ id: user.id }).from(user)).map((u) => u.id)).toEqual(expect.arrayContaining(ids))
      expect(await audits()).toEqual([
        expect.objectContaining({
          action: 'school_delete',
          targetSchoolId: fx.iut.id,
          reason: 'test school',
          details: { kind: 'school_delete', school: ref(fx.iut), classes: 2, courses: 2, students: 3 },
        }),
      ])
    })

    it('deletes nothing when the typed name is wrong', async () => {
      await expect(adminDeleteSchool(admin, fx.iut.id, 'ENSET')).rejects.toMatchObject({ code: 'VALIDATION' })
      expect(await schoolRow(fx.iut.id)).toBeDefined()
      expect(await db.select().from(class_)).toHaveLength(2)
      expect(await audits()).toEqual([])
    })

    it('deletes a school with no classes', async () => {
      await adminDeleteSchool(admin, fx.lycee.id, 'Lycée Bilingue')
      expect(await schoolRow(fx.lycee.id)).toBeUndefined()
      expect((await audits())[0].details).toEqual({
        kind: 'school_delete',
        school: ref(fx.lycee),
        classes: 0,
        courses: 0,
        students: 0,
      })
    })

    it('keeps a note that is also placed in a course at another school', async () => {
      const { k } = await ensetClass()
      const [t1, t2] = await db
        .insert(courseTopic)
        .values([
          { courseId: fx.k1.id, title: 'Week 1', position: 0 },
          { courseId: k.id, title: 'Week 1', position: 0 },
        ])
        .returning()
      const [note] = await db.insert(resource).values({ ownerId: lecA.user.id, kind: 'note', title: 'Shared' }).returning()
      await db.insert(resourcePlacement).values([
        { resourceId: note.id, courseId: fx.k1.id, topicId: t1.id, position: 0 },
        { resourceId: note.id, courseId: k.id, topicId: t2.id, position: 0 },
      ])
      await adminDeleteSchool(admin, fx.iut.id, 'IUT')
      expect(await db.select({ id: resource.id }).from(resource)).toEqual([{ id: note.id }])
      expect(await db.select({ courseId: resourcePlacement.courseId }).from(resourcePlacement)).toEqual([{ courseId: k.id }])
    })

    it('merges: the classes move with their courses and students, the emptied school goes', async () => {
      const { cls, k } = await ensetClass()
      const before = await db.select().from(classStudent).where(eq(classStudent.classId, cls.id))
      await mergeSchools(admin, fx.enset.id, fx.iut.id, 'same school')
      expect(await schoolRow(fx.enset.id)).toBeUndefined()
      expect((await db.select().from(class_).where(eq(class_.id, cls.id)))[0].schoolId).toBe(fx.iut.id)
      expect(await db.select({ id: course.id }).from(course).where(eq(course.classId, cls.id))).toEqual([{ id: k.id }])
      expect(await db.select().from(classStudent).where(eq(classStudent.classId, cls.id))).toEqual(before)
      expect((await getSchoolDetail(admin, fx.iut.id)).classes).toBe(3)
      expect(await audits()).toEqual([
        expect.objectContaining({
          action: 'school_merge',
          targetSchoolId: fx.iut.id,
          reason: 'same school',
          details: { kind: 'school_merge', from: ref(fx.enset), into: ref(fx.iut), classesMoved: 1 },
        }),
      ])
    })

    it('takes the removed school’s location only when the kept one has none', async () => {
      await setSchoolLocation(lecB, fx.enset.id, { latitude: 4.05, longitude: 9.7, radiusM: 300 })
      await mergeSchools(admin, fx.enset.id, fx.iut.id)
      expect(await schoolRow(fx.iut.id)).toMatchObject({ latitude: 4.05, longitude: 9.7, radiusM: 300 })

      await setSchoolLocation(lecA, fx.lycee.id, { latitude: 4.15, longitude: 9.24, radiusM: 800 })
      await mergeSchools(admin, fx.iut.id, fx.lycee.id)
      expect(await schoolRow(fx.lycee.id)).toMatchObject({ latitude: 4.15, longitude: 9.24, radiusM: 800 })
    })

    it('refuses to merge a school into itself or into one that is gone, changing nothing', async () => {
      await expect(mergeSchools(admin, fx.iut.id, fx.iut.id)).rejects.toMatchObject({ code: 'VALIDATION' })
      await expect(mergeSchools(admin, fx.iut.id, 'gone')).rejects.toMatchObject({ code: 'NOT_FOUND' })
      await expect(mergeSchools(admin, 'gone', fx.iut.id)).rejects.toMatchObject({ code: 'NOT_FOUND' })
      expect(await db.select().from(class_).where(eq(class_.schoolId, fx.iut.id))).toHaveLength(2)
      expect(await audits()).toEqual([])
    })
  })
})
