import { eq } from 'drizzle-orm'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { setNowForTests } from '@/server/core/clock'
import type { Ctx } from '@/server/core/context'
import type { Db } from '@/server/db'
import {
  assignment,
  assignmentAttachment,
  assignmentReminder,
  class_,
  classLecturer,
  classStudent,
  course,
  courseRosterAdjustment,
  file,
  school,
  submission,
  submissionFile,
  user,
} from '@/server/db/schema'
import { createClass, joinClassAsLecturer, joinClassAsStudent } from '@/server/classes/service'
import { createCourse, setRosterAdjustment } from '@/server/courses/service'
import { createSchool } from '@/server/schools/service'
import { sendNotifications, type Notification } from '@/server/email/notify'
import { setAfterResponseForTests } from '@/server/lib/after-response'
import { createTestDb } from '@/test/db'
import { ctxFor, makeUser } from '@/test/factories'
import {
  createAssignment,
  deleteDraftAssignment,
  getSubmissionForLecturer,
  gradeSubmission,
  listCourseAssignments,
  listSubmissions,
  publishAssignment,
  releaseGrades,
  updateAssignment,
  type AssignmentInput,
} from './lecturer'

vi.mock('@/server/email/notify', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/server/email/notify')>()
  return { ...actual, sendNotifications: vi.fn(async () => ({ sent: 0, skipped: 0, failed: 0 })) }
})

const DAY = 24 * 60 * 60_000
const send = vi.mocked(sendNotifications)

const paragraph = (text: string) => ({ type: 'paragraph', content: [{ type: 'text', text, styles: {} }], children: [] })

function baseInput(over: Partial<AssignmentInput> = {}): AssignmentInput {
  return {
    title: 'Sorting lab',
    instructions: [paragraph('Implement merge sort.')],
    dueAt: new Date(Date.now() + 7 * DAY),
    maxMark: 20,
    weight: 1,
    submissionMode: 'both',
    latePolicy: 'accept',
    attachmentIds: [],
    ...over,
  }
}

describe('lecturer assignment services', () => {
  let db: Db
  let tasks: Array<() => Promise<void>>

  beforeAll(async () => {
    db = await createTestDb()
  })
  beforeEach(() => {
    tasks = []
    setAfterResponseForTests((task) => {
      tasks.push(task)
    })
    send.mockClear()
    vi.stubEnv('BETTER_AUTH_URL', 'https://clasync.test')
  })
  afterEach(async () => {
    setNowForTests(null)
    setAfterResponseForTests(null)
    vi.unstubAllEnvs()
    await db.delete(submissionFile)
    await db.delete(submission)
    await db.delete(assignmentAttachment)
    await db.delete(assignment)
    await db.delete(file)
    await db.delete(courseRosterAdjustment)
    await db.delete(course)
    await db.delete(classStudent)
    await db.delete(classLecturer)
    await db.delete(class_)
    await db.delete(school)
    await db.delete(user)
  })

  async function runScheduled() {
    const pending = tasks
    tasks = []
    for (const task of pending) await task()
  }

  /** Every notification handed to sendNotifications so far, flattened. */
  const sentNotifications = (): Notification[] => send.mock.calls.flatMap((c) => c[0])

  async function setup() {
    const lecturer = ctxFor(db, await makeUser(db, { role: 'lecturer', name: 'Dr Owner' }))
    const sch = await createSchool(lecturer, { name: 'University of Buea', town: 'Buea' })
    const cls = await createClass(lecturer, { schoolId: sch.id, name: 'CS L3', academicYear: '2026/27' })
    const colleague = ctxFor(db, await makeUser(db, { role: 'lecturer', name: 'Dr Colleague' }))
    await joinClassAsLecturer(colleague, cls.lecturerCode!)
    const algo = await createCourse(lecturer, { classId: cls.id, title: 'Algorithms', semester: 1 })
    const alice = ctxFor(db, await makeUser(db, { role: 'student', name: 'Alice', locale: 'en' }))
    const bob = ctxFor(db, await makeUser(db, { role: 'student', name: 'Bob', locale: 'fr' }))
    const carol = ctxFor(db, await makeUser(db, { role: 'student', name: 'Carol', locale: 'en' }))
    await joinClassAsStudent(alice, cls.studentCode!, 'UB1')
    await joinClassAsStudent(bob, cls.studentCode!, 'UB2')
    await joinClassAsStudent(carol, cls.studentCode!, 'UB3')
    tasks = [] // the class-join confirmations; these tests are about assignment emails
    return { lecturer, colleague, algo, alice, bob, carol, cls }
  }

  /** A file row as the upload flow leaves it (confirmed unless said otherwise). */
  async function makeFile(
    owner: Ctx,
    over: Partial<{ purpose: 'assignment' | 'submission'; confirmed: boolean; name: string; assignmentId: string }> = {},
  ): Promise<string> {
    const id = crypto.randomUUID()
    const name = over.name ?? 'brief.pdf'
    const prefix = (over.purpose ?? 'assignment') === 'assignment' ? 'assignments' : 'submissions'
    await db.insert(file).values({
      id,
      ownerId: owner.user.id,
      purpose: over.purpose ?? 'assignment',
      storageKey: `${prefix}/${over.assignmentId ?? 'x'}/${id}-${name}`,
      name,
      mimeType: 'application/pdf',
      sizeBytes: 1234,
      confirmedAt: over.confirmed === false ? null : new Date(),
    })
    return id
  }

  async function addSubmission(
    student: Ctx,
    assignmentId: string,
    over: Partial<typeof submission.$inferInsert> = {},
  ): Promise<string> {
    const [row] = await db
      .insert(submission)
      .values({ assignmentId, studentId: student.user.id, submittedAt: new Date(), ...over })
      .returning({ id: submission.id })
    return row.id
  }

  /** The version a grading page was loaded with: the submission's current `submittedAt`. */
  async function versionOf(submissionId: string): Promise<Date> {
    const [row] = await db.select({ at: submission.submittedAt }).from(submission).where(eq(submission.id, submissionId))
    return row.at
  }

  async function published(lecturer: Ctx, courseId: string, over: Partial<AssignmentInput> = {}) {
    const a = await createAssignment(lecturer, courseId, baseInput(over))
    await publishAssignment(lecturer, a.id)
    await runScheduled()
    send.mockClear()
    return a
  }

  it('a colleague, a student or a nonexistent id gets FORBIDDEN on every function', async () => {
    const { lecturer, colleague, alice, algo } = await setup()
    const a = await createAssignment(lecturer, algo.id, baseInput())
    const subId = await addSubmission(alice, a.id)

    for (const who of [colleague, alice]) {
      const calls = [
        () => createAssignment(who, algo.id, baseInput()),
        () => updateAssignment(who, a.id, baseInput()),
        () => deleteDraftAssignment(who, a.id),
        () => publishAssignment(who, a.id),
        () => listCourseAssignments(who, algo.id),
        () => listSubmissions(who, a.id),
        () => getSubmissionForLecturer(who, subId),
        () => gradeSubmission(who, subId, { mark: 10, feedback: null, expectedSubmittedAt: new Date() }),
        () => releaseGrades(who, a.id),
      ]
      for (const call of calls) await expect(call()).rejects.toMatchObject({ code: 'FORBIDDEN' })
    }
    const missing = [
      () => createAssignment(lecturer, 'no-such-course', baseInput()),
      () => updateAssignment(lecturer, 'nope', baseInput()),
      () => deleteDraftAssignment(lecturer, 'nope'),
      () => publishAssignment(lecturer, 'nope'),
      () => listCourseAssignments(lecturer, 'nope'),
      () => listSubmissions(lecturer, 'nope'),
      () => getSubmissionForLecturer(lecturer, 'nope'),
      () => gradeSubmission(lecturer, 'nope', { mark: 10, feedback: null, expectedSubmittedAt: new Date() }),
      () => releaseGrades(lecturer, 'nope'),
    ]
    for (const call of missing) await expect(call()).rejects.toMatchObject({ code: 'FORBIDDEN' })

    // Nothing changed.
    const [row] = await db.select().from(assignment).where(eq(assignment.id, a.id))
    expect(row.status).toBe('draft')
    expect(await db.select().from(assignment)).toHaveLength(1)
    expect(send).not.toHaveBeenCalled()
    expect(tasks).toHaveLength(0)
  })

  it('creates a draft with sanitised instructions', async () => {
    const { lecturer, algo } = await setup()
    const instructions = [
      {
        type: 'paragraph',
        content: [
          { type: 'link', href: 'javascript:alert(1)', content: [{ type: 'text', text: 'click me', styles: {} }] },
          { type: 'link', href: 'https://example.org', content: [{ type: 'text', text: 'docs', styles: {} }] },
        ],
        children: [],
      },
    ]
    const dueAt = new Date(Date.now() + 3 * DAY)
    const a = await createAssignment(lecturer, algo.id, baseInput({ title: '  Lab 1  ', instructions, dueAt, maxMark: 20.5, weight: 2.25 }))
    expect(a).toMatchObject({
      courseId: algo.id,
      title: 'Lab 1',
      dueAt,
      maxMark: 20.5,
      weight: 2.25,
      submissionMode: 'both',
      latePolicy: 'accept',
      status: 'draft',
      publishedAt: null,
      gradesReleasedAt: null,
      attachments: [],
    })
    const json = JSON.stringify(a.instructions)
    expect(json).not.toContain('javascript:')
    expect(json).toContain('click me')
    expect(json).toContain('https://example.org')

    const [row] = await db.select().from(assignment).where(eq(assignment.id, a.id))
    expect(row.createdBy).toBe(lecturer.user.id)
    expect(row.instructions).toEqual(a.instructions)
  })

  it('validates every field on create', async () => {
    const { lecturer, algo } = await setup()
    const cases: Array<[Partial<AssignmentInput>, string]> = [
      [{ title: 'A' }, 'title'],
      [{ title: 'x'.repeat(201) }, 'title'],
      [{ instructions: 'not blocks' }, 'instructions'],
      [{ dueAt: new Date(Date.now() - 60_000) }, 'dueAt'],
      [{ dueAt: new Date('nonsense') }, 'dueAt'],
      [{ maxMark: 0 }, 'maxMark'],
      [{ maxMark: 1001 }, 'maxMark'],
      [{ maxMark: 10.123 }, 'maxMark'],
      [{ maxMark: Number.NaN }, 'maxMark'],
      [{ weight: 0 }, 'weight'],
      [{ weight: 0.2 }, 'weight'],
      [{ weight: 100.5 }, 'weight'],
      [{ weight: 1.005 }, 'weight'],
      [{ submissionMode: 'video' as 'files' }, 'submissionMode'],
      [{ latePolicy: 'maybe' as 'accept' }, 'latePolicy'],
    ]
    for (const [over, field] of cases) {
      await expect(createAssignment(lecturer, algo.id, baseInput(over))).rejects.toMatchObject({
        code: 'VALIDATION',
        details: { fields: expect.arrayContaining([field]) },
      })
    }
    // The bounds themselves are accepted.
    await expect(createAssignment(lecturer, algo.id, baseInput({ maxMark: 1, weight: 0.25, title: 'AB' }))).resolves.toBeTruthy()
    await expect(createAssignment(lecturer, algo.id, baseInput({ maxMark: 1000, weight: 100 }))).resolves.toBeTruthy()
    expect(await db.select().from(assignment)).toHaveLength(2)
  })

  it('attachments must be the lecturer’s own confirmed assignment files, kept in the given order', async () => {
    const { lecturer, colleague, alice, algo } = await setup()
    const a = await createAssignment(lecturer, algo.id, baseInput())
    const mine1 = await makeFile(lecturer, { assignmentId: a.id, name: 'one.pdf' })
    const mine2 = await makeFile(lecturer, { assignmentId: a.id, name: 'two.pdf' })
    const unconfirmed = await makeFile(lecturer, { assignmentId: a.id, confirmed: false })
    const theirs = await makeFile(colleague, { assignmentId: a.id })
    const submissionFileId = await makeFile(alice, { purpose: 'submission', assignmentId: a.id })
    const wrongPurpose = await makeFile(lecturer, { purpose: 'submission', assignmentId: a.id })

    for (const bad of [unconfirmed, theirs, submissionFileId, wrongPurpose, 'no-such-file']) {
      await expect(updateAssignment(lecturer, a.id, baseInput({ attachmentIds: [mine1, bad] }))).rejects.toMatchObject({
        code: 'VALIDATION',
      })
      await expect(createAssignment(lecturer, algo.id, baseInput({ attachmentIds: [bad] }))).rejects.toMatchObject({
        code: 'VALIDATION',
      })
    }
    expect(await db.select().from(assignmentAttachment)).toHaveLength(0)

    const updated = await updateAssignment(lecturer, a.id, baseInput({ attachmentIds: [mine2, mine1] }))
    expect(updated.attachments.map((f) => f.id)).toEqual([mine2, mine1])
    expect(updated.attachments[0]).toEqual({ id: mine2, name: 'two.pdf', mimeType: 'application/pdf', sizeBytes: 1234 })

    // Replacing the list replaces the links.
    const again = await updateAssignment(lecturer, a.id, baseInput({ attachmentIds: [mine1] }))
    expect(again.attachments.map((f) => f.id)).toEqual([mine1])
    expect(await db.select().from(assignmentAttachment)).toHaveLength(1)
  })

  it('updates the fields and updatedAt; the mode is locked once a submission exists', async () => {
    const { lecturer, alice, algo } = await setup()
    const a = await createAssignment(lecturer, algo.id, baseInput())
    const [before] = await db.select().from(assignment).where(eq(assignment.id, a.id))
    await new Promise((r) => setTimeout(r, 5))

    const dueAt = new Date(Date.now() + 10 * DAY)
    const updated = await updateAssignment(
      lecturer,
      a.id,
      baseInput({ title: 'Sorting lab v2', dueAt, maxMark: 40, weight: 3, submissionMode: 'text', latePolicy: 'close' }),
    )
    expect(updated).toMatchObject({ title: 'Sorting lab v2', dueAt, maxMark: 40, weight: 3, submissionMode: 'text', latePolicy: 'close' })
    const [after] = await db.select().from(assignment).where(eq(assignment.id, a.id))
    expect(after.updatedAt.getTime()).toBeGreaterThan(before.updatedAt.getTime())

    await publishAssignment(lecturer, a.id)
    await addSubmission(alice, a.id, { mark: 30 })
    await expect(updateAssignment(lecturer, a.id, baseInput({ dueAt, maxMark: 40, submissionMode: 'files' }))).rejects.toMatchObject({
      code: 'CONFLICT',
      details: { reason: 'mode_locked' },
    })
    // Same mode: other fields still editable.
    await expect(
      updateAssignment(lecturer, a.id, baseInput({ title: 'Renamed', dueAt, maxMark: 40, submissionMode: 'text' })),
    ).resolves.toMatchObject({ title: 'Renamed', status: 'published' })
    // A max mark below a mark already given is refused.
    await expect(
      updateAssignment(lecturer, a.id, baseInput({ dueAt, maxMark: 20, submissionMode: 'text' })),
    ).rejects.toMatchObject({ code: 'VALIDATION', details: { fields: ['maxMark'] } })
  })

  it('an unchanged past due date can be kept on update; a new one must be in the future', async () => {
    const { lecturer, algo } = await setup()
    const a = await createAssignment(lecturer, algo.id, baseInput())
    const past = new Date(Date.now() - DAY)
    await db.update(assignment).set({ dueAt: past }).where(eq(assignment.id, a.id))
    await expect(updateAssignment(lecturer, a.id, baseInput({ dueAt: past, title: 'Fixed typo' }))).resolves.toMatchObject({
      title: 'Fixed typo',
      dueAt: past,
    })
    await expect(
      updateAssignment(lecturer, a.id, baseInput({ dueAt: new Date(Date.now() - 2 * DAY) })),
    ).rejects.toMatchObject({ code: 'VALIDATION', details: { fields: ['dueAt'] } })
  })

  it('a new due date recomputes who is late; only an extension clears the reminders (ruling B11)', async () => {
    const { lecturer, algo, alice, bob, carol } = await setup()
    const t0 = new Date('2026-11-10T08:00:00Z')
    setNowForTests(() => t0)
    const at = (hours: number) => new Date(t0.getTime() + hours * 60 * 60_000)
    const a = await published(lecturer, algo.id, { dueAt: at(72) })
    const other = await published(lecturer, algo.id, { dueAt: at(72) })
    // In before the original deadline (72 h) at 12 h, 48 h and 60 h.
    await addSubmission(alice, a.id, { submittedAt: at(48), isLate: false })
    await addSubmission(bob, a.id, { submittedAt: at(60), isLate: false })
    await addSubmission(carol, a.id, { submittedAt: at(12), isLate: false })
    await addSubmission(alice, other.id, { submittedAt: at(48), isLate: false })
    const remind = (assignmentId: string, student: Ctx) =>
      db.insert(assignmentReminder).values({ assignmentId, studentId: student.user.id, sentAt: t0 })
    await remind(a.id, alice)
    await remind(a.id, bob)
    await remind(other.id, bob)

    const lateness = async (assignmentId: string) =>
      Object.fromEntries(
        (await db.select().from(submission).where(eq(submission.assignmentId, assignmentId))).map((s) => [
          s.studentId,
          s.isLate,
        ]),
      )
    const reminded = async (assignmentId: string) =>
      (await db.select().from(assignmentReminder).where(eq(assignmentReminder.assignmentId, assignmentId)))
        .map((r) => r.studentId)
        .sort()

    // Shortened to 24 h: work handed in after it becomes late; reminders stay (no second email).
    await updateAssignment(lecturer, a.id, baseInput({ dueAt: at(24) }))
    expect(await lateness(a.id)).toEqual({ [alice.user.id]: true, [bob.user.id]: true, [carol.user.id]: false })
    expect(await reminded(a.id)).toEqual([alice.user.id, bob.user.id].sort())

    // Same due date, another field: nothing about lateness or reminders changes.
    await updateAssignment(lecturer, a.id, baseInput({ dueAt: at(24), title: 'Renamed' }))
    expect(await lateness(a.id)).toEqual({ [alice.user.id]: true, [bob.user.id]: true, [carol.user.id]: false })
    expect(await reminded(a.id)).toEqual([alice.user.id, bob.user.id].sort())

    // Extended to 50 h: Alice (48 h) is on time again, Bob (60 h) is still late; the reminders go so
    // the new deadline can be reminded.
    await updateAssignment(lecturer, a.id, baseInput({ dueAt: at(50) }))
    expect(await lateness(a.id)).toEqual({ [alice.user.id]: false, [bob.user.id]: true, [carol.user.id]: false })
    expect(await reminded(a.id)).toEqual([])

    // The other assignment is untouched.
    expect(await lateness(other.id)).toEqual({ [alice.user.id]: false })
    expect(await reminded(other.id)).toEqual([bob.user.id])
  })

  it('deletes a draft; a published assignment is a CONFLICT', async () => {
    const { lecturer, algo } = await setup()
    const draft = await createAssignment(lecturer, algo.id, baseInput())
    await deleteDraftAssignment(lecturer, draft.id)
    expect(await db.select().from(assignment)).toHaveLength(0)

    const pub = await published(lecturer, algo.id)
    await expect(deleteDraftAssignment(lecturer, pub.id)).rejects.toMatchObject({
      code: 'CONFLICT',
      details: { reason: 'published' },
    })
    expect(await db.select().from(assignment)).toHaveLength(1)
  })

  it('publishing emails each current roster student once, in their language, after the response', async () => {
    const { lecturer, algo, alice, bob, carol, cls } = await setup()
    const [sch] = await db.select().from(school)
    const other = await createClass(lecturer, { schoolId: sch.id, name: 'Other', academicYear: '2026/27' })
    const visitor = ctxFor(db, await makeUser(db, { role: 'student', name: 'Visitor', locale: 'fr' }))
    await joinClassAsStudent(visitor, other.studentCode!, 'UB9')
    tasks = [] // the visitor's join confirmation
    await setRosterAdjustment(lecturer, algo.id, carol.user.id, 'exclude')
    await setRosterAdjustment(lecturer, algo.id, visitor.user.id, 'include')
    expect(cls.id).toBeTruthy()

    const a = await createAssignment(lecturer, algo.id, baseInput())
    const detail = await publishAssignment(lecturer, a.id)
    expect(detail.status).toBe('published')
    expect(detail.publishedAt).toBeInstanceOf(Date)

    // Scheduled, not sent yet.
    expect(tasks).toHaveLength(1)
    expect(send).not.toHaveBeenCalled()
    await runScheduled()
    expect(send).toHaveBeenCalledTimes(1)

    const sent = sentNotifications()
    expect(sent.map((n) => n.to).sort()).toEqual([alice.user.email, bob.user.email, visitor.user.email].sort())
    const byTo = (email: string) => sent.find((n) => n.to === email)!
    expect(byTo(alice.user.email).locale).toBe('en')
    expect(byTo(bob.user.email).locale).toBe('fr')
    expect(byTo(visitor.user.email).locale).toBe('fr')
    expect(byTo(alice.user.email).subject).toContain('Algorithms')
    expect(byTo(alice.user.email).subject).toContain('Sorting lab')
    expect(byTo(alice.user.email).subject).not.toBe(byTo(bob.user.email).subject)
    expect(byTo(alice.user.email).react.props).toMatchObject({
      url: `https://clasync.test/assignments/${a.id}`,
      studentName: 'Alice',
      courseTitle: 'Algorithms',
      assignmentTitle: 'Sorting lab',
    })

    // Publishing again changes nothing and emails nobody.
    const again = await publishAssignment(lecturer, a.id)
    expect(again.publishedAt).toEqual(detail.publishedAt)
    await runScheduled()
    expect(send).toHaveBeenCalledTimes(1)
  })

  it('refuses to publish an assignment whose due date has passed', async () => {
    const { lecturer, algo } = await setup()
    const a = await createAssignment(lecturer, algo.id, baseInput())
    await db.update(assignment).set({ dueAt: new Date(Date.now() - DAY) }).where(eq(assignment.id, a.id))
    await expect(publishAssignment(lecturer, a.id)).rejects.toMatchObject({ code: 'VALIDATION', details: { fields: ['dueAt'] } })
    expect(tasks).toHaveLength(0)
  })

  it('without BETTER_AUTH_URL the links are relative and one warning is logged', async () => {
    const { lecturer, algo } = await setup()
    vi.stubEnv('BETTER_AUTH_URL', '')
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const a = await createAssignment(lecturer, algo.id, baseInput())
    await publishAssignment(lecturer, a.id)
    await runScheduled()
    expect(sentNotifications().map((n) => (n.react.props as { url: string }).url)).toEqual(Array(3).fill(`/assignments/${a.id}`))
    expect(warn.mock.calls.filter((c) => String(c[0]).includes('BETTER_AUTH_URL'))).toHaveLength(1)
    warn.mockRestore()
  })

  it('lists the course’s assignments in due date order with roster counts', async () => {
    const { lecturer, algo, alice, bob, carol } = await setup()
    const later = await published(lecturer, algo.id, { title: 'Later', dueAt: new Date(Date.now() + 9 * DAY) })
    const sooner = await published(lecturer, algo.id, { title: 'Sooner', dueAt: new Date(Date.now() + 2 * DAY) })
    const draft = await createAssignment(lecturer, algo.id, baseInput({ title: 'Draft', dueAt: new Date(Date.now() + 5 * DAY) }))
    await addSubmission(alice, sooner.id)
    await addSubmission(bob, sooner.id, { isLate: true, mark: 12 })
    await addSubmission(carol, sooner.id, { mark: 15 })
    // A student no longer on the roster does not count.
    await setRosterAdjustment(lecturer, algo.id, carol.user.id, 'exclude')

    const list = await listCourseAssignments(lecturer, algo.id)
    expect(list.map((a) => a.title)).toEqual(['Sooner', 'Draft', 'Later'])
    expect(list[0]).toMatchObject({ id: sooner.id, submittedCount: 1, lateCount: 1, gradedCount: 1, rosterSize: 2 })
    expect(list[1]).toMatchObject({ id: draft.id, status: 'draft', submittedCount: 0, lateCount: 0, gradedCount: 0, rosterSize: 2 })
    expect(list[2]).toMatchObject({ id: later.id, submittedCount: 0, rosterSize: 2 })
  })

  it('listSubmissions shows missing / submitted / late for the current roster, in roster order', async () => {
    const { lecturer, algo, alice, bob, carol } = await setup()
    const a = await published(lecturer, algo.id)
    const aliceSub = await addSubmission(alice, a.id, { mark: 18 })
    const at = new Date(Date.now() + 8 * DAY)
    const bobSub = await addSubmission(bob, a.id, { isLate: true, submittedAt: at })

    const { assignment: detail, rows } = await listSubmissions(lecturer, a.id)
    expect(detail.id).toBe(a.id)
    expect(rows).toEqual([
      { studentId: alice.user.id, name: 'Alice', matricule: 'UB1', state: 'submitted', submissionId: aliceSub, submittedAt: expect.any(Date), mark: 18, graded: true, hasText: false, fileCount: 0 },
      { studentId: bob.user.id, name: 'Bob', matricule: 'UB2', state: 'late', submissionId: bobSub, submittedAt: at, mark: null, graded: false, hasText: false, fileCount: 0 },
      { studentId: carol.user.id, name: 'Carol', matricule: 'UB3', state: 'missing', submissionId: null, submittedAt: null, mark: null, graded: false, hasText: false, fileCount: 0 },
    ])
  })

  it('opens one submission with its text, files and grade', async () => {
    const { lecturer, algo, alice } = await setup()
    const a = await published(lecturer, algo.id)
    const subId = await addSubmission(alice, a.id, { text: [paragraph('My answer')], isLate: true, mark: 14.5, feedback: 'Good' })
    const f1 = await makeFile(alice, { purpose: 'submission', assignmentId: a.id, name: 'page1.jpg' })
    const f2 = await makeFile(alice, { purpose: 'submission', assignmentId: a.id, name: 'page2.jpg' })
    await db.insert(submissionFile).values([
      { submissionId: subId, fileId: f2, position: 1 },
      { submissionId: subId, fileId: f1, position: 0 },
    ])

    const view = await getSubmissionForLecturer(lecturer, subId)
    expect(view).toMatchObject({
      assignment: { id: a.id, title: 'Sorting lab' },
      student: { id: alice.user.id, name: 'Alice', matricule: 'UB1' },
      text: [paragraph('My answer')],
      isLate: true,
      mark: 14.5,
      feedback: 'Good',
    })
    expect(view.files.map((f) => f.name)).toEqual(['page1.jpg', 'page2.jpg'])
    expect(view.submittedAt).toBeInstanceOf(Date)
    expect(view.suggestion).toBeNull()

    const { rows } = await listSubmissions(lecturer, a.id)
    expect(rows.find((r) => r.submissionId === subId)).toMatchObject({ hasText: true, fileCount: 2 })

    const suggestedAt = new Date('2026-11-08T12:00:00Z')
    await db
      .update(submission)
      .set({ suggestedMark: 15, suggestedFeedback: 'Clear.', suggestedAt })
      .where(eq(submission.id, subId))
    expect((await getSubmissionForLecturer(lecturer, subId)).suggestion).toEqual({ mark: 15, feedback: 'Clear.', at: suggestedAt })
  })

  it('grades with a valid mark and feedback, recording who and when', async () => {
    const { lecturer, algo, alice } = await setup()
    const a = await published(lecturer, algo.id)
    const subId = await addSubmission(alice, a.id)

    for (const mark of [20.3, 21, -1, Number.NaN, '15' as unknown as number]) {
      await expect(gradeSubmission(lecturer, subId, { mark, feedback: null, expectedSubmittedAt: await versionOf(subId) })).rejects.toMatchObject({
        code: 'VALIDATION',
        details: { fields: ['mark'] },
      })
    }
    await expect(gradeSubmission(lecturer, subId, { mark: 10, feedback: 'x'.repeat(5001), expectedSubmittedAt: await versionOf(subId) })).rejects.toMatchObject({
      code: 'VALIDATION',
      details: { fields: ['feedback'] },
    })

    await gradeSubmission(lecturer, subId, { mark: 17.75, feedback: '  Well argued.  ', expectedSubmittedAt: await versionOf(subId) })
    const [row] = await db.select().from(submission).where(eq(submission.id, subId))
    expect(row).toMatchObject({ mark: 17.75, feedback: 'Well argued.', gradedBy: lecturer.user.id })
    expect(row.gradedAt).toBeInstanceOf(Date)

    await gradeSubmission(lecturer, subId, { mark: 20, feedback: '   ', expectedSubmittedAt: await versionOf(subId) })
    const [again] = await db.select().from(submission).where(eq(submission.id, subId))
    expect(again).toMatchObject({ mark: 20, feedback: null })
  })

  it('refuses a grade for a version the student has since replaced (CONFLICT resubmitted)', async () => {
    const { lecturer, algo, alice } = await setup()
    const a = await published(lecturer, algo.id)
    const loadedAt = new Date('2026-11-10T08:00:00.123Z')
    const subId = await addSubmission(alice, a.id, { submittedAt: loadedAt })

    // The student hands in a new version while the lecturer's page still shows the first one.
    const replacedAt = new Date('2026-11-10T09:30:00.456Z')
    await db.update(submission).set({ submittedAt: replacedAt }).where(eq(submission.id, subId))
    await expect(
      gradeSubmission(lecturer, subId, { mark: 15, feedback: 'For the old version', expectedSubmittedAt: loadedAt }),
    ).rejects.toMatchObject({ code: 'CONFLICT', details: { reason: 'resubmitted' } })
    const [row] = await db.select().from(submission).where(eq(submission.id, subId))
    expect(row).toMatchObject({ mark: null, feedback: null, gradedAt: null, gradedBy: null })

    // A missing or invalid version is a VALIDATION error, never a silent overwrite.
    for (const expectedSubmittedAt of [new Date(Number.NaN), undefined, '2026-11-10T09:30:00.456Z']) {
      await expect(
        gradeSubmission(lecturer, subId, { mark: 15, feedback: null, expectedSubmittedAt: expectedSubmittedAt as Date }),
      ).rejects.toMatchObject({ code: 'VALIDATION', details: { fields: ['submittedAt'] } })
    }

    // Reloaded: the current version grades.
    await gradeSubmission(lecturer, subId, { mark: 15, feedback: null, expectedSubmittedAt: replacedAt })
    const [graded] = await db.select().from(submission).where(eq(submission.id, subId))
    expect(graded).toMatchObject({ mark: 15, gradedBy: lecturer.user.id })
  })

  it('releasing grades emails graded students once; ungraded students are not emailed', async () => {
    const { lecturer, algo, alice, bob, carol } = await setup()
    const a = await published(lecturer, algo.id)
    const aliceSub = await addSubmission(alice, a.id)
    await addSubmission(bob, a.id)
    await gradeSubmission(lecturer, aliceSub, { mark: 16, feedback: null, expectedSubmittedAt: await versionOf(aliceSub) })
    expect(carol.user.id).toBeTruthy()

    await expect(releaseGrades(lecturer, a.id)).resolves.toEqual({ released: 1 })
    const [row] = await db.select().from(assignment).where(eq(assignment.id, a.id))
    expect(row.gradesReleasedAt).toBeInstanceOf(Date)
    expect(send).not.toHaveBeenCalled()
    await runScheduled()
    expect(sentNotifications().map((n) => n.to)).toEqual([alice.user.email])
    expect(sentNotifications()[0].subject).toContain('Sorting lab')
    expect(sentNotifications()[0].react.props).toMatchObject({ url: `https://clasync.test/assignments/${a.id}` })

    // Second release: same timestamp, no email.
    await expect(releaseGrades(lecturer, a.id)).resolves.toEqual({ released: 1 })
    await runScheduled()
    expect(send).toHaveBeenCalledTimes(1)
    const [again] = await db.select().from(assignment).where(eq(assignment.id, a.id))
    expect(again.gradesReleasedAt).toEqual(row.gradesReleasedAt)

    // Grading after release is an edit: allowed, no new email.
    const bobSub = (await db.select().from(submission).where(eq(submission.studentId, bob.user.id)))[0].id
    await gradeSubmission(lecturer, bobSub, { mark: 11, feedback: null, expectedSubmittedAt: await versionOf(bobSub) })
    await gradeSubmission(lecturer, aliceSub, { mark: 17, feedback: 'Updated', expectedSubmittedAt: await versionOf(aliceSub) })
    await runScheduled()
    expect(send).toHaveBeenCalledTimes(1)
  })

  it('grades of a draft cannot be released', async () => {
    const { lecturer, algo } = await setup()
    const a = await createAssignment(lecturer, algo.id, baseInput())
    await expect(releaseGrades(lecturer, a.id)).rejects.toMatchObject({ code: 'CONFLICT', details: { reason: 'not_published' } })
    const [row] = await db.select().from(assignment).where(eq(assignment.id, a.id))
    expect(row.gradesReleasedAt).toBeNull()
  })
})
