import type { ReactElement } from 'react'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { createClass, joinClassAsStudent } from '@/server/classes/service'
import { setNowForTests } from '@/server/core/clock'
import { createCourse } from '@/server/courses/service'
import type { Db } from '@/server/db'
import { assignment, class_, classLecturer, classStudent, course, school, submission } from '@/server/db/schema'
import { setResendClientFactoryForTests, setRetryWaitForTests, type NotifyClient } from '@/server/email/notify'
import { setAfterResponseForTests } from '@/server/lib/after-response'
import { createSchool } from '@/server/schools/service'
import { createTestDb } from '@/test/db'
import { ctxFor, makeUser } from '@/test/factories'
import { submitAssignment } from './student'

type Sent = { to: string; subject: string; react: ReactElement<Record<string, unknown>> }

const BASE = new Date('2026-11-10T08:00:00Z')
const DAY = 24 * 60 * 60_000
const para = (text: string) => [{ type: 'paragraph', content: [{ type: 'text', text, styles: {} }] }]

describe('assignment submission receipts', () => {
  let db: Db
  let tasks: Array<() => Promise<void>>
  let sent: Sent[]

  beforeAll(async () => {
    db = await createTestDb()
  })
  beforeEach(() => {
    tasks = []
    sent = []
    setNowForTests(() => BASE)
    setAfterResponseForTests((task) => {
      tasks.push(task)
    })
    const client: NotifyClient = {
      batch: {
        send: async (payload) => {
          sent.push(...(payload as Sent[]))
          return { error: null }
        },
      },
    }
    setResendClientFactoryForTests(() => client)
    setRetryWaitForTests(async () => {})
    vi.stubEnv('RESEND_API_KEY', 're_test')
    vi.stubEnv('BETTER_AUTH_URL', 'https://clasync.test/')
  })
  afterEach(async () => {
    setNowForTests(null)
    setAfterResponseForTests(null)
    setResendClientFactoryForTests(null)
    setRetryWaitForTests(null)
    vi.unstubAllEnvs()
    vi.restoreAllMocks()
    await db.delete(submission)
    await db.delete(assignment)
    await db.delete(course)
    await db.delete(classStudent)
    await db.delete(classLecturer)
    await db.delete(class_)
    await db.delete(school)
  })

  async function flush() {
    const pending = tasks.splice(0)
    for (const task of pending) await task()
  }

  async function setup(over: { dueAt?: Date; latePolicy?: 'accept' | 'close' } = {}) {
    const lecturer = ctxFor(db, await makeUser(db, { role: 'lecturer', name: 'Dr Owner' }))
    const sch = await createSchool(lecturer, { name: 'University of Buea', town: 'Buea' })
    const cls = await createClass(lecturer, { schoolId: sch.id, name: 'CS L3', academicYear: '2026/27' })
    const algo = await createCourse(lecturer, { classId: cls.id, title: 'Algorithms', semester: 1 })
    const alice = ctxFor(db, await makeUser(db, { role: 'student', name: 'Alice', locale: 'en' }))
    const bob = ctxFor(db, await makeUser(db, { role: 'student', name: 'Bob', locale: 'fr' }))
    await joinClassAsStudent(alice, cls.studentCode!, 'UB1')
    await joinClassAsStudent(bob, cls.studentCode!, 'UB2')
    const [a] = await db
      .insert(assignment)
      .values({
        courseId: algo.id,
        title: 'Sorting lab',
        instructions: para('Sort things'),
        dueAt: over.dueAt ?? new Date(BASE.getTime() + 3 * DAY),
        maxMark: 20,
        weight: 1,
        submissionMode: 'text',
        latePolicy: over.latePolicy ?? 'accept',
        status: 'published',
        publishedAt: BASE,
        createdBy: lecturer.user.id,
      })
      .returning({ id: assignment.id })
    tasks.splice(0) // the class-join confirmations
    return { alice, bob, assignmentId: a.id }
  }

  it('emails the student a receipt in their language after the response, with an absolute link', async () => {
    const { alice, assignmentId } = await setup()
    const result = await submitAssignment(alice, assignmentId, { text: para('My answer'), fileIds: [] })
    expect(result).toEqual({ submittedAt: BASE, isLate: false })
    expect(sent).toHaveLength(0)
    await flush()

    expect(sent).toHaveLength(1)
    const [m] = sent
    expect(m.to).toBe(alice.user.email)
    expect(m.subject).toBe('Submission received: Sorting lab in Algorithms')
    expect(m.react.props).toMatchObject({
      locale: 'en',
      studentName: 'Alice',
      courseTitle: 'Algorithms',
      assignmentTitle: 'Sorting lab',
      submittedAt: BASE,
      isLate: false,
      url: `https://clasync.test/assignments/${assignmentId}`,
    })
  })

  it('a late submission is flagged in the receipt, in French for a French student', async () => {
    const { bob, assignmentId } = await setup({ dueAt: new Date(BASE.getTime() - DAY) })
    expect(await submitAssignment(bob, assignmentId, { text: para('Late answer'), fileIds: [] })).toMatchObject({ isLate: true })
    await flush()
    expect(sent).toHaveLength(1)
    expect(sent[0].to).toBe(bob.user.email)
    expect(sent[0].subject).toBe('Rendu reçu : Sorting lab (Algorithms)')
    expect(sent[0].react.props).toMatchObject({ locale: 'fr', isLate: true })
  })

  it('a refused submission sends nothing', async () => {
    const { alice, assignmentId } = await setup({ dueAt: new Date(BASE.getTime() - DAY), latePolicy: 'close' })
    await expect(submitAssignment(alice, assignmentId, { text: para('Too late'), fileIds: [] })).rejects.toMatchObject({
      code: 'CONFLICT',
    })
    await expect(submitAssignment(alice, assignmentId, { text: [], fileIds: [] })).rejects.toBeTruthy()
    expect(tasks).toHaveLength(0)
    await flush()
    expect(sent).toHaveLength(0)
  })

  it('a provider outage never fails the submission', async () => {
    const { alice, assignmentId } = await setup()
    vi.spyOn(console, 'error').mockImplementation(() => {})
    setResendClientFactoryForTests(() => {
      throw new Error('down')
    })
    expect(await submitAssignment(alice, assignmentId, { text: para('My answer'), fileIds: [] })).toEqual({
      submittedAt: BASE,
      isLate: false,
    })
    await expect(flush()).resolves.toBeUndefined()
    const rows = await db.select().from(submission)
    expect(rows).toHaveLength(1)
  })
})
