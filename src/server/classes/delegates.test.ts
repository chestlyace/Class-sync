import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { setNowForTests } from '@/server/core/clock'
import type { Ctx } from '@/server/core/context'
import type { Db } from '@/server/db'
import { class_, course, school, user } from '@/server/db/schema'
import {
  closeWindow,
  createSession,
  deleteSession,
  getCheckInLink,
  getLiveWindow,
  getSession,
  listCurrentSessions,
  openWindow,
  setAttendanceOverride,
} from '@/server/attendance/sessions'
import { createCourse, setRosterAdjustment } from '@/server/courses/service'
import { createSchool } from '@/server/schools/service'
import { createTestDb } from '@/test/db'
import { ctxFor, makeUser } from '@/test/factories'
import { appointDelegate, isCourseDelegate, listClassDelegates, MAX_DELEGATES, removeDelegate } from './delegates'
import { createClass, joinClassAsLecturer, joinClassAsStudent, removeStudentFromClass } from './service'

vi.mock('@/server/push/send', () => ({
  sendPush: vi.fn(async () => ({ sent: 0, skipped: 0, failed: 0, removed: 0 })),
  queuePush: vi.fn(async () => {}),
}))

const HOUR = 3_600_000

describe('class delegates', () => {
  let db: Db

  beforeAll(async () => {
    db = await createTestDb()
  })
  beforeEach(() => vi.stubEnv('BETTER_AUTH_SECRET', 'a'.repeat(64)))
  afterEach(async () => {
    vi.unstubAllEnvs()
    setNowForTests(null)
    await db.delete(course)
    await db.delete(class_)
    await db.delete(school)
    await db.delete(user)
  })

  /** A class with two lecturers (each with a course), and three students on it. */
  async function setup() {
    const lecturer = ctxFor(db, await makeUser(db, { role: 'lecturer', name: 'Dr Owner' }))
    const sch = await createSchool(lecturer, { name: `School ${crypto.randomUUID()}`, town: 'Buea' })
    const cls = await createClass(lecturer, { schoolId: sch.id, name: 'CS L3', academicYear: '2026/27' })
    const colleague = ctxFor(db, await makeUser(db, { role: 'lecturer', name: 'Dr Colleague' }))
    await joinClassAsLecturer(colleague, cls.lecturerCode!)
    const algo = await createCourse(lecturer, { classId: cls.id, title: 'Algorithms', semester: 1 })
    const nets = await createCourse(colleague, { classId: cls.id, title: 'Networks', semester: 1 })
    const students: Ctx[] = []
    for (const [i, name] of ['Ada', 'Ben', 'Cy'].entries()) {
      const s = ctxFor(db, await makeUser(db, { role: 'student', name }))
      await joinClassAsStudent(s, cls.studentCode!, `UB${i + 1}`)
      students.push(s)
    }
    const [ada, ben, cy] = students
    return { lecturer, colleague, cls, algo, nets, ada, ben, cy }
  }

  describe('appointing', () => {
    it('any lecturer of the class appoints up to two delegates; a third is refused', async () => {
      const { lecturer, colleague, cls, ada, ben, cy } = await setup()
      await appointDelegate(lecturer, cls.id, ada.user.id)
      await appointDelegate(colleague, cls.id, ben.user.id)
      // Appointing again changes nothing.
      await appointDelegate(colleague, cls.id, ada.user.id)
      expect(MAX_DELEGATES).toBe(2)
      await expect(appointDelegate(lecturer, cls.id, cy.user.id)).rejects.toMatchObject({
        code: 'CONFLICT',
        details: { reason: 'max_delegates' },
      })
      expect((await listClassDelegates(lecturer, cls.id)).map((d) => d.name)).toEqual(['Ada', 'Ben'])

      // A seat frees up once one is removed.
      await removeDelegate(colleague, cls.id, ada.user.id)
      await appointDelegate(lecturer, cls.id, cy.user.id)
      expect((await listClassDelegates(lecturer, cls.id)).map((d) => d.name)).toEqual(['Ben', 'Cy'])
    })

    it('only lecturers of the class appoint, and only its active students can be appointed', async () => {
      const { lecturer, cls, ada, ben } = await setup()
      const outsider = ctxFor(db, await makeUser(db, { role: 'lecturer' }))
      await expect(appointDelegate(outsider, cls.id, ada.user.id)).rejects.toMatchObject({ code: 'FORBIDDEN' })
      await expect(appointDelegate(ben, cls.id, ada.user.id)).rejects.toMatchObject({ code: 'FORBIDDEN' })
      const stranger = ctxFor(db, await makeUser(db, { role: 'student' }))
      await expect(appointDelegate(lecturer, cls.id, stranger.user.id)).rejects.toMatchObject({ code: 'VALIDATION' })
      await removeStudentFromClass(lecturer, cls.id, ben.user.id)
      await expect(appointDelegate(lecturer, cls.id, ben.user.id)).rejects.toMatchObject({ code: 'VALIDATION' })
    })

    it("students of the class see who their delegates are; others don't", async () => {
      const { lecturer, cls, ada, ben } = await setup()
      await appointDelegate(lecturer, cls.id, ada.user.id)
      expect(await listClassDelegates(ben, cls.id)).toEqual([{ studentId: ada.user.id, name: 'Ada' }])
      const stranger = ctxFor(db, await makeUser(db, { role: 'student' }))
      await expect(listClassDelegates(stranger, cls.id)).rejects.toMatchObject({ code: 'FORBIDDEN' })
    })
  })

  describe('taking attendance', () => {
    it("a delegate runs a session for every course of the class, the lecturer's included", async () => {
      const { lecturer, colleague, cls, algo, nets, ada } = await setup()
      await appointDelegate(lecturer, cls.id, ada.user.id)

      for (const c of [algo, nets]) {
        const session = await createSession(ada, c.id, { requireOnCampus: false })
        const live = await openWindow(ada, session.id, 'start')
        expect(live.code).toMatch(/^[A-Z0-9]{6}$/)
        expect((await getLiveWindow(ada, live.windowId)).open).toBe(true)
        expect(await getCheckInLink(ada, live.windowId)).toMatch(/^\/check-in\?w=/)
        await closeWindow(ada, live.windowId)
        const view = await getSession(ada, session.id)
        expect(view).toMatchObject({ canManage: false, startedBy: 'Ada' })
        expect(view.students).toHaveLength(3)
        expect((await listCurrentSessions(ada, c.id)).map((s) => s.id)).toEqual([session.id])
      }

      // The lecturer still runs and manages everything, and sees who started it.
      const [own] = await listCurrentSessions(lecturer, algo.id)
      expect(await getSession(lecturer, own.id)).toMatchObject({ canManage: true, startedBy: 'Ada' })
      const mine = await createSession(colleague, nets.id, { requireOnCampus: false })
      expect(await getSession(colleague, mine.id)).toMatchObject({ canManage: true, startedBy: null })
    })

    it('corrections and deleting stay with the lecturer', async () => {
      const { lecturer, cls, algo, ada, ben } = await setup()
      await appointDelegate(lecturer, cls.id, ada.user.id)
      const session = await createSession(ada, algo.id, { requireOnCampus: false })
      await expect(setAttendanceOverride(ada, session.id, ben.user.id, 'present')).rejects.toMatchObject({
        code: 'FORBIDDEN',
      })
      await expect(deleteSession(ada, session.id)).rejects.toMatchObject({ code: 'FORBIDDEN' })
      await setAttendanceOverride(lecturer, session.id, ben.user.id, 'present')
      await deleteSession(lecturer, session.id)
    })

    it("a delegate can't open a session that is over: no browsing past attendance", async () => {
      const { lecturer, cls, algo, ada } = await setup()
      await appointDelegate(lecturer, cls.id, ada.user.id)
      const start = new Date('2026-11-24T08:00:00Z')
      setNowForTests(() => start)
      const session = await createSession(lecturer, algo.id, { requireOnCampus: false })
      expect((await getSession(ada, session.id)).session.id).toBe(session.id)
      setNowForTests(() => new Date(start.getTime() + 13 * HOUR))
      await expect(getSession(ada, session.id)).rejects.toMatchObject({ code: 'FORBIDDEN' })
      expect(await listCurrentSessions(ada, algo.id)).toEqual([])
      // The lecturer still can.
      expect((await getSession(lecturer, session.id)).session.id).toBe(session.id)
    })

    it('other students, removed delegates and delegates excluded from a course are refused', async () => {
      const { lecturer, cls, algo, nets, ada, ben, cy } = await setup()
      await expect(createSession(ben, algo.id, { requireOnCampus: false })).rejects.toMatchObject({ code: 'FORBIDDEN' })

      await appointDelegate(lecturer, cls.id, ada.user.id)
      await appointDelegate(lecturer, cls.id, cy.user.id)
      const session = await createSession(ada, algo.id, { requireOnCampus: false })

      await removeDelegate(lecturer, cls.id, ada.user.id)
      await expect(openWindow(ada, session.id, 'start')).rejects.toMatchObject({ code: 'FORBIDDEN' })
      expect(await isCourseDelegate(db, ada.user.id, algo.id)).toBe(false)

      // Removed from the class: the delegate role no longer counts.
      await removeStudentFromClass(lecturer, cls.id, cy.user.id)
      await expect(createSession(cy, algo.id, { requireOnCampus: false })).rejects.toMatchObject({ code: 'FORBIDDEN' })
      expect(await listClassDelegates(lecturer, cls.id)).toEqual([])

      // Excluded from one course: still a delegate for the others.
      await appointDelegate(lecturer, cls.id, ben.user.id)
      await setRosterAdjustment(lecturer, algo.id, ben.user.id, 'exclude')
      await expect(createSession(ben, algo.id, { requireOnCampus: false })).rejects.toMatchObject({ code: 'FORBIDDEN' })
      expect(await isCourseDelegate(db, ben.user.id, nets.id)).toBe(true)
    })
  })
})
