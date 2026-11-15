import { eq } from 'drizzle-orm'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Ctx } from '@/server/core/context'
import type { Db } from '@/server/db'
import { adminAction, class_, classLecturer, classStudent, course, file, resource, school } from '@/server/db/schema'
import { createTestDb } from '@/test/db'
import { ctxFor, makeUser } from '@/test/factories'
import { createClass, joinClassAsLecturer, joinClassAsStudent } from '@/server/classes/service'
import { createCourse } from '@/server/courses/service'
import { createSchool } from '@/server/schools/service'
import { getSchoolDeletion, getSchoolDetail, listSchools, searchSchoolsForMerge } from './schools'

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
})
