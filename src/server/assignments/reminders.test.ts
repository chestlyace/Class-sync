import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { setConfigForTests, config } from '@/server/core/config'
import type { Db } from '@/server/db'
import {
  assignment,
  assignmentReminder,
  class_,
  classLecturer,
  classStudent,
  course,
  courseRosterAdjustment,
  school,
  submission,
  user,
} from '@/server/db/schema'
import { setResendClientFactoryForTests, setRetryWaitForTests, type NotifyClient } from '@/server/email/notify'
import { createTestDb } from '@/test/db'
import { ctxFor, makeUser } from '@/test/factories'
import { createSchool } from '@/server/schools/service'
import { createClass, joinClassAsStudent } from '@/server/classes/service'
import { createCourse, setRosterAdjustment } from '@/server/courses/service'
import { sendDueReminders } from './reminders'

const HOUR = 3_600_000

describe('sendDueReminders', () => {
  let db: Db
  let batches: Array<Array<{ to: string; subject: string }>>
  const originalTz = config.timeZone

  beforeAll(async () => {
    db = await createTestDb()
  })
  beforeEach(() => {
    batches = []
    vi.stubEnv('RESEND_API_KEY', 'test-key')
    vi.stubEnv('BETTER_AUTH_URL', 'https://clasync.test')
    const client: NotifyClient = {
      batch: {
        send: async (payload) => {
          batches.push(payload.map((p) => ({ to: p.to, subject: p.subject })))
          return { error: null }
        },
      },
    }
    setResendClientFactoryForTests(() => client)
    setRetryWaitForTests(async () => {})
  })
  afterEach(async () => {
    vi.unstubAllEnvs()
    setResendClientFactoryForTests(null)
    setRetryWaitForTests(null)
    setConfigForTests({ timeZone: originalTz })
    await db.delete(assignmentReminder)
    await db.delete(submission)
    await db.delete(assignment)
    await db.delete(courseRosterAdjustment)
    await db.delete(course)
    await db.delete(classStudent)
    await db.delete(classLecturer)
    await db.delete(class_)
    await db.delete(school)
    await db.delete(user)
  })

  const sent = () => batches.flat()

  async function setup() {
    const lecturer = ctxFor(db, await makeUser(db, { role: 'lecturer' }))
    const sch = await createSchool(lecturer, { name: 'University of Buea', town: 'Buea' })
    const cls = await createClass(lecturer, { schoolId: sch.id, name: 'CS L3', academicYear: '2026/27' })
    const algo = await createCourse(lecturer, { classId: cls.id, title: 'Algorithms', semester: 1 })
    const students = []
    for (const [i, locale] of (['en', 'fr', 'en'] as const).entries()) {
      const s = ctxFor(db, await makeUser(db, { role: 'student', name: `Student ${i}`, locale }))
      await joinClassAsStudent(s, cls.studentCode!, `UB${i}`)
      students.push(s)
    }
    return { lecturer, algo, students, cls }
  }

  async function addAssignment(
    courseId: string,
    createdBy: string,
    at: Date,
    dueInHours: number,
    overrides: Partial<typeof assignment.$inferInsert> = {},
  ) {
    const [row] = await db
      .insert(assignment)
      .values({
        courseId,
        title: 'Sorting lab',
        dueAt: new Date(at.getTime() + dueInHours * HOUR),
        maxMark: 20,
        submissionMode: 'text',
        status: 'published',
        publishedAt: at,
        createdBy,
        ...overrides,
      })
      .returning()
    return row
  }

  it('reminds the roster students who have not submitted, once', async () => {
    const at = new Date()
    const { lecturer, algo, students } = await setup()
    const a = await addAssignment(algo.id, lecturer.user.id, at, 23)
    await db.insert(submission).values({ assignmentId: a.id, studentId: students[0].user.id, submittedAt: at })

    await expect(sendDueReminders(db, at)).resolves.toEqual({ assignments: 1, reminded: 2 })
    expect(sent().map((m) => m.to).sort()).toEqual([students[1].user.email, students[2].user.email].sort())
    expect(sent().every((m) => m.subject.includes('Algorithms') && m.subject.includes('Sorting lab'))).toBe(true)
    // each in the student's own language
    const fr = sent().find((m) => m.to === students[1].user.email)!
    const en = sent().find((m) => m.to === students[2].user.email)!
    expect(fr.subject).not.toBe(en.subject)

    const rows = await db.select().from(assignmentReminder)
    expect(rows.map((r) => r.studentId).sort()).toEqual([students[1].user.id, students[2].user.id].sort())

    batches = []
    await expect(sendDueReminders(db, new Date(at.getTime() + HOUR))).resolves.toEqual({ assignments: 1, reminded: 0 })
    expect(sent()).toHaveLength(0)
  })

  it('two concurrent runs remind each student once in total', async () => {
    const at = new Date()
    const { lecturer, algo, students } = await setup()
    const a = await addAssignment(algo.id, lecturer.user.id, at, 23)
    await db.insert(submission).values({ assignmentId: a.id, studentId: students[0].user.id, submittedAt: at })

    const [r1, r2] = await Promise.all([sendDueReminders(db, at), sendDueReminders(db, at)])
    expect(r1.reminded + r2.reminded).toBe(2)
    expect(sent()).toHaveLength(2)
    expect(new Set(sent().map((m) => m.to)).size).toBe(2)
  })

  it('ignores assignments due beyond 24 hours, past due, or still drafts', async () => {
    const at = new Date()
    const { lecturer, algo } = await setup()
    await addAssignment(algo.id, lecturer.user.id, at, 25)
    await addAssignment(algo.id, lecturer.user.id, at, -1)
    await addAssignment(algo.id, lecturer.user.id, at, 23, { status: 'draft', publishedAt: null })
    await expect(sendDueReminders(db, at)).resolves.toEqual({ assignments: 0, reminded: 0 })
    expect(sent()).toHaveLength(0)
    expect(await db.select().from(assignmentReminder)).toHaveLength(0)
  })

  it('a run 6 hours late still reminds', async () => {
    const at = new Date()
    const { lecturer, algo } = await setup()
    await addAssignment(algo.id, lecturer.user.id, at, 23)
    await expect(sendDueReminders(db, new Date(at.getTime() + 6 * HOUR))).resolves.toEqual({ assignments: 1, reminded: 3 })
  })

  it('uses the current roster: excluded students are skipped, included ones are reminded', async () => {
    const at = new Date()
    const { lecturer, algo, students } = await setup()
    const [sch] = await db.select().from(school)
    const otherClass = await createClass(lecturer, { schoolId: sch.id, name: 'Other', academicYear: '2026/27' })
    const visitor = ctxFor(db, await makeUser(db, { role: 'student', name: 'Visitor' }))
    await joinClassAsStudent(visitor, otherClass.studentCode!, 'UB9')
    await setRosterAdjustment(lecturer, algo.id, students[0].user.id, 'exclude')
    await setRosterAdjustment(lecturer, algo.id, visitor.user.id, 'include')
    await addAssignment(algo.id, lecturer.user.id, at, 5)
    const result = await sendDueReminders(db, at)
    expect(result).toEqual({ assignments: 1, reminded: 3 })
    const to = sent().map((m) => m.to)
    expect(to).not.toContain(students[0].user.email)
    expect(to).toContain(visitor.user.email)
  })

  it('sends once per assignment, each call with its own recipients', async () => {
    const at = new Date()
    const { lecturer, algo, students } = await setup()
    await addAssignment(algo.id, lecturer.user.id, at, 5, { title: 'Lab one' })
    const a2 = await addAssignment(algo.id, lecturer.user.id, at, 10, { title: 'Lab two' })
    await db.insert(submission).values({ assignmentId: a2.id, studentId: students[0].user.id, submittedAt: at })
    await expect(sendDueReminders(db, at)).resolves.toEqual({ assignments: 2, reminded: 5 })
    expect(batches).toHaveLength(2)
    const byLab = (t: string) => batches.find((b) => b.every((m) => m.subject.includes(t)))!
    expect(byLab('Lab one').map((m) => m.to).sort()).toEqual(students.map((s) => s.user.email).sort())
    expect(byLab('Lab two').map((m) => m.to).sort()).toEqual([students[1].user.email, students[2].user.email].sort())
  })

  it('warns once per run, without addresses, when BETTER_AUTH_URL is unset', async () => {
    const at = new Date()
    const { lecturer, algo } = await setup()
    await addAssignment(algo.id, lecturer.user.id, at, 5)
    await addAssignment(algo.id, lecturer.user.id, at, 6)
    vi.stubEnv('BETTER_AUTH_URL', '')
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    await sendDueReminders(db, at)
    const calls = warn.mock.calls.filter((c) => String(c[0]).includes('BETTER_AUTH_URL'))
    expect(calls).toHaveLength(1)
    expect(JSON.stringify(warn.mock.calls)).not.toContain('@example.com')
    warn.mockRestore()
  })

  it('links each email to the assignment page', async () => {
    const at = new Date()
    const { lecturer, algo } = await setup()
    const a = await addAssignment(algo.id, lecturer.user.id, at, 2)
    const send = vi.fn(async () => ({ error: null }))
    setResendClientFactoryForTests(() => ({ batch: { send } }))
    await sendDueReminders(db, at)
    const html = JSON.stringify((send.mock.calls as unknown[][])[0][0])
    expect(html).toContain(`https://clasync.test/assignments/${a.id}`)
  })
})
