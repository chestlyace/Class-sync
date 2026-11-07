import { and, asc, eq } from 'drizzle-orm'
import { afterEach, beforeAll, describe, expect, it } from 'vitest'
import { setNowForTests } from '@/server/core/clock'
import type { Ctx } from '@/server/core/context'
import type { Db } from '@/server/db'
import {
  assignment,
  assignmentAttachment,
  class_,
  classLecturer,
  classStudent,
  course,
  courseRosterAdjustment,
  file,
  school,
  submission,
  submissionFile,
} from '@/server/db/schema'
import { createClass, joinClassAsStudent } from '@/server/classes/service'
import { createCourse } from '@/server/courses/service'
import { createSchool } from '@/server/schools/service'
import { createTestDb } from '@/test/db'
import { ctxFor, makeUser } from '@/test/factories'
import { getAssignmentForStudent, listMyAssignments, submitAssignment } from './student'

const HOUR = 60 * 60_000
const DAY = 24 * HOUR
const BASE = new Date('2026-11-10T08:00:00Z')

const para = (text: string) => [{ type: 'paragraph', content: [{ type: 'text', text, styles: {} }] }]

describe('student assignment services', () => {
  let db: Db
  let clock: Date

  function setClock(at: Date) {
    clock = at
    setNowForTests(() => clock)
  }

  beforeAll(async () => {
    db = await createTestDb()
  })
  afterEach(async () => {
    setNowForTests(null)
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
  })

  async function setup() {
    setClock(BASE)
    const lecturer = ctxFor(db, await makeUser(db, { role: 'lecturer', name: 'Dr Owner' }))
    const sch = await createSchool(lecturer, { name: 'University of Buea', town: 'Buea' })
    const cls = await createClass(lecturer, { schoolId: sch.id, name: 'CS L3', academicYear: '2026/27' })
    const algo = await createCourse(lecturer, { classId: cls.id, title: 'Algorithms', semester: 1 })
    const db2 = await createCourse(lecturer, { classId: cls.id, title: 'Databases', semester: 1 })
    const alice = ctxFor(db, await makeUser(db, { role: 'student', name: 'Alice' }))
    const bob = ctxFor(db, await makeUser(db, { role: 'student', name: 'Bob' }))
    const outsider = ctxFor(db, await makeUser(db, { role: 'student', name: 'Olga' }))
    await joinClassAsStudent(alice, cls.studentCode!, 'UB1')
    await joinClassAsStudent(bob, cls.studentCode!, 'UB2')
    return { lecturer, algo, db2, alice, bob, outsider }
  }

  async function makeAssignment(
    courseId: string,
    by: Ctx,
    over: Partial<{
      title: string
      status: 'draft' | 'published'
      latePolicy: 'accept' | 'close'
      submissionMode: 'files' | 'text' | 'both'
      dueAt: Date
    }> = {},
  ): Promise<string> {
    const status = over.status ?? 'published'
    const [row] = await db
      .insert(assignment)
      .values({
        courseId,
        title: over.title ?? 'Homework',
        instructions: para('Do the exercises'),
        dueAt: over.dueAt ?? new Date(BASE.getTime() + 3 * DAY),
        maxMark: 20,
        weight: 2,
        submissionMode: over.submissionMode ?? 'both',
        latePolicy: over.latePolicy ?? 'accept',
        status,
        publishedAt: status === 'published' ? BASE : null,
        createdBy: by.user.id,
      })
      .returning({ id: assignment.id })
    return row.id
  }

  /** A confirmed file row, as left by a finished upload. */
  async function makeFile(
    owner: Ctx,
    assignmentId: string,
    purpose: 'assignment' | 'submission' = 'submission',
    name = 'answer.pdf',
  ): Promise<string> {
    const id = crypto.randomUUID()
    const storageKey =
      purpose === 'submission'
        ? `submissions/${assignmentId}/${owner.user.id}/${id}-${name}`
        : `assignments/${assignmentId}/${id}-${name}`
    await db.insert(file).values({
      id,
      ownerId: owner.user.id,
      purpose,
      storageKey,
      name,
      mimeType: 'application/pdf',
      sizeBytes: 1234,
      confirmedAt: BASE,
    })
    return id
  }

  async function grade(assignmentId: string, student: Ctx, by: Ctx, mark: number, feedback: string | null) {
    await db
      .update(submission)
      .set({ mark, feedback, gradedAt: clock, gradedBy: by.user.id })
      .where(and(eq(submission.assignmentId, assignmentId), eq(submission.studentId, student.user.id)))
  }

  async function release(assignmentId: string) {
    await db.update(assignment).set({ gradesReleasedAt: clock }).where(eq(assignment.id, assignmentId))
  }

  async function submissionsOf(assignmentId: string) {
    return db.select().from(submission).where(eq(submission.assignmentId, assignmentId))
  }

  async function linksOf(submissionId: string) {
    return db
      .select({ fileId: submissionFile.fileId, position: submissionFile.position })
      .from(submissionFile)
      .where(eq(submissionFile.submissionId, submissionId))
      .orderBy(asc(submissionFile.position))
  }

  describe('access', () => {
    it('refuses non-rostered students, lecturers, drafts and unknown ids with FORBIDDEN', async () => {
      const { lecturer, algo, alice, outsider } = await setup()
      const published = await makeAssignment(algo.id, lecturer)
      const draft = await makeAssignment(algo.id, lecturer, { status: 'draft' })
      const input = { text: para('hi'), fileIds: [] }

      for (const ctx of [outsider, lecturer]) {
        await expect(getAssignmentForStudent(ctx, published)).rejects.toMatchObject({ code: 'FORBIDDEN' })
        await expect(submitAssignment(ctx, published, input)).rejects.toMatchObject({ code: 'FORBIDDEN' })
      }
      for (const id of [draft, 'no-such-assignment']) {
        await expect(getAssignmentForStudent(alice, id)).rejects.toMatchObject({ code: 'FORBIDDEN' })
        await expect(submitAssignment(alice, id, input)).rejects.toMatchObject({ code: 'FORBIDDEN' })
      }
      await expect(listMyAssignments(lecturer)).rejects.toMatchObject({ code: 'FORBIDDEN' })
      expect(await listMyAssignments(outsider)).toEqual([])
      expect(await submissionsOf(published)).toHaveLength(0)
    })

    it('shows the assignment with its attachments and no submission yet', async () => {
      const { lecturer, algo, alice } = await setup()
      const id = await makeAssignment(algo.id, lecturer, { title: 'Sorting' })
      const second = await makeFile(lecturer, id, 'assignment', 'b.pdf')
      const first = await makeFile(lecturer, id, 'assignment', 'a.pdf')
      await db.insert(assignmentAttachment).values([
        { assignmentId: id, fileId: second, position: 1 },
        { assignmentId: id, fileId: first, position: 0 },
      ])

      const view = await getAssignmentForStudent(alice, id)
      expect(view.assignment).toMatchObject({
        id,
        courseId: algo.id,
        title: 'Sorting',
        instructions: para('Do the exercises'),
        maxMark: 20,
        weight: 2,
        submissionMode: 'both',
        latePolicy: 'accept',
        status: 'published',
        gradesReleasedAt: null,
      })
      expect(view.assignment.attachments.map((a) => a.id)).toEqual([first, second])
      expect(view.assignment.attachments[0]).toEqual({ id: first, name: 'a.pdf', mimeType: 'application/pdf', sizeBytes: 1234 })
      expect(view.mySubmission).toBeNull()
      expect(view.canSubmit).toBe('ok')
    })

    it('never shows another student’s submission', async () => {
      const { lecturer, algo, alice, bob } = await setup()
      const id = await makeAssignment(algo.id, lecturer)
      await submitAssignment(bob, id, { text: para('Bob answer'), fileIds: [] })
      expect((await getAssignmentForStudent(alice, id)).mySubmission).toBeNull()
      expect((await listMyAssignments(alice))[0].state).toBe('todo')
    })
  })

  describe('submitAssignment', () => {
    it('submits on time, then a resubmission replaces text and files in the same row', async () => {
      const { lecturer, algo, alice } = await setup()
      const id = await makeAssignment(algo.id, lecturer)
      const f1 = await makeFile(alice, id)
      const f2 = await makeFile(alice, id)
      const f3 = await makeFile(alice, id)

      const first = await submitAssignment(alice, id, { text: para('First'), fileIds: [f1, f2] })
      expect(first).toEqual({ submittedAt: BASE, isLate: false })

      setClock(new Date(BASE.getTime() + HOUR))
      const second = await submitAssignment(alice, id, { text: para('Second'), fileIds: [f3, f1] })
      expect(second).toEqual({ submittedAt: new Date(BASE.getTime() + HOUR), isLate: false })

      const rows = await submissionsOf(id)
      expect(rows).toHaveLength(1)
      expect(rows[0].text).toEqual(para('Second'))
      expect(await linksOf(rows[0].id)).toEqual([
        { fileId: f3, position: 0 },
        { fileId: f1, position: 1 },
      ])

      const view = await getAssignmentForStudent(alice, id)
      expect(view.mySubmission).toMatchObject({
        text: para('Second'),
        submittedAt: new Date(BASE.getTime() + HOUR),
        isLate: false,
        mark: null,
        feedback: null,
      })
      expect(view.mySubmission!.files.map((f) => f.id)).toEqual([f3, f1])
    })

    it('sanitises the typed answer', async () => {
      const { lecturer, algo, alice } = await setup()
      const id = await makeAssignment(algo.id, lecturer, { submissionMode: 'text' })
      const text = [
        {
          type: 'paragraph',
          content: [{ type: 'link', href: 'javascript:alert(1)', content: [{ type: 'text', text: 'click', styles: {} }] }],
        },
      ]
      await submitAssignment(alice, id, { text, fileIds: [] })
      const [row] = await submissionsOf(id)
      expect(JSON.stringify(row.text)).not.toContain('javascript')
      expect(row.text).toEqual([{ type: 'paragraph', content: [{ type: 'text', text: 'click', styles: {} }] }])
    })

    it('concurrent submissions leave one row', async () => {
      const { lecturer, algo, alice } = await setup()
      const id = await makeAssignment(algo.id, lecturer)
      const f1 = await makeFile(alice, id)
      const f2 = await makeFile(alice, id)
      await Promise.all([
        submitAssignment(alice, id, { text: para('A'), fileIds: [f1] }),
        submitAssignment(alice, id, { text: para('B'), fileIds: [f2] }),
      ])
      const rows = await submissionsOf(id)
      expect(rows).toHaveLength(1)
      expect(await linksOf(rows[0].id)).toHaveLength(1)
    })

    it('accepts and flags late work with the accept policy', async () => {
      const { lecturer, algo, alice } = await setup()
      const dueAt = new Date(BASE.getTime() + DAY)
      const id = await makeAssignment(algo.id, lecturer, { dueAt })
      await submitAssignment(alice, id, { text: para('On time'), fileIds: [] })

      const later = new Date(dueAt.getTime() + 1)
      setClock(later)
      expect((await getAssignmentForStudent(alice, id)).canSubmit).toBe('ok')
      expect(await submitAssignment(alice, id, { text: para('Late'), fileIds: [] })).toEqual({
        submittedAt: later,
        isLate: true,
      })
      const [row] = await submissionsOf(id)
      expect(row).toMatchObject({ isLate: true, submittedAt: later })
    })

    it('refuses work after the deadline with the close policy (CONFLICT closed)', async () => {
      const { lecturer, algo, alice } = await setup()
      const dueAt = new Date(BASE.getTime() + DAY)
      const id = await makeAssignment(algo.id, lecturer, { dueAt, latePolicy: 'close' })
      await submitAssignment(alice, id, { text: para('On time'), fileIds: [] })

      setClock(new Date(dueAt.getTime() + 1))
      expect((await getAssignmentForStudent(alice, id)).canSubmit).toBe('closed')
      await expect(submitAssignment(alice, id, { text: para('Late'), fileIds: [] })).rejects.toMatchObject({
        code: 'CONFLICT',
        details: { reason: 'closed' },
      })
      const [row] = await submissionsOf(id)
      expect(row.text).toEqual(para('On time'))
    })

    it('applies the submission mode rules', async () => {
      const { lecturer, algo, alice } = await setup()
      const filesOnly = await makeAssignment(algo.id, lecturer, { submissionMode: 'files' })
      const textOnly = await makeAssignment(algo.id, lecturer, { submissionMode: 'text' })
      const both = await makeAssignment(algo.id, lecturer, { submissionMode: 'both' })
      const empty = [{ type: 'paragraph', content: [] }]

      // files: needs a file, ignores the text (even an invalid one).
      await expect(submitAssignment(alice, filesOnly, { text: para('x'), fileIds: [] })).rejects.toMatchObject({
        code: 'VALIDATION',
        details: { reason: 'files_required' },
      })
      const f = await makeFile(alice, filesOnly)
      await submitAssignment(alice, filesOnly, { text: 'not blocks', fileIds: [f] })
      expect((await submissionsOf(filesOnly))[0].text).toBeNull()

      // text: needs non-empty valid text, no files.
      for (const text of [null, undefined, [], empty]) {
        await expect(submitAssignment(alice, textOnly, { text, fileIds: [] })).rejects.toMatchObject({
          code: 'VALIDATION',
          details: { reason: 'text_required' },
        })
      }
      await expect(submitAssignment(alice, textOnly, { text: 'not blocks', fileIds: [] })).rejects.toMatchObject({
        code: 'VALIDATION',
        details: { fields: ['text'] },
      })
      const g = await makeFile(alice, textOnly)
      await expect(submitAssignment(alice, textOnly, { text: para('x'), fileIds: [g] })).rejects.toMatchObject({
        code: 'VALIDATION',
        details: { reason: 'files_not_allowed' },
      })
      await submitAssignment(alice, textOnly, { text: para('x'), fileIds: [] })

      // both: at least one of them; empty text is stored as no text.
      await expect(submitAssignment(alice, both, { text: empty, fileIds: [] })).rejects.toMatchObject({
        code: 'VALIDATION',
        details: { reason: 'empty' },
      })
      const h = await makeFile(alice, both)
      await submitAssignment(alice, both, { text: empty, fileIds: [h] })
      expect((await submissionsOf(both))[0].text).toBeNull()
      await submitAssignment(alice, both, { text: para('only text'), fileIds: [] })
      const [row] = await submissionsOf(both)
      expect(row.text).toEqual(para('only text'))
      expect(await linksOf(row.id)).toEqual([])
    })

    it('refuses another student’s file, a lecturer file, an unconfirmed file and duplicates (VALIDATION)', async () => {
      const { lecturer, algo, alice, bob } = await setup()
      const id = await makeAssignment(algo.id, lecturer)
      const bobs = await makeFile(bob, id)
      const attachment = await makeFile(lecturer, id, 'assignment')
      const mine = await makeFile(alice, id)
      const unconfirmed = await makeFile(alice, id)
      await db.update(file).set({ confirmedAt: null }).where(eq(file.id, unconfirmed))

      for (const fileIds of [[bobs], [attachment], [unconfirmed], [mine, mine], [mine, 'no-such-file']]) {
        await expect(submitAssignment(alice, id, { text: para('x'), fileIds })).rejects.toMatchObject({
          code: 'VALIDATION',
        })
      }
      await expect(
        submitAssignment(alice, id, { text: para('x'), fileIds: 'nope' as unknown as string[] }),
      ).rejects.toMatchObject({ code: 'VALIDATION' })
      expect(await submissionsOf(id)).toHaveLength(0)
    })

    /** `ctx` whose db runs `change` just before the submit transaction starts (after the first checks). */
    function racing(ctx: Ctx, change: () => Promise<unknown>): Ctx {
      const racingDb = Object.create(db) as Db
      racingDb.transaction = (async (...args: Parameters<Db['transaction']>) => {
        await change()
        return db.transaction(...args)
      }) as Db['transaction']
      return { ...ctx, db: racingDb }
    }

    it('validates against the assignment as locked inside the transaction', async () => {
      const { lecturer, algo, alice } = await setup()
      const id = await makeAssignment(algo.id, lecturer, { submissionMode: 'text' })
      const toFiles = racing(alice, () =>
        db.update(assignment).set({ submissionMode: 'files' }).where(eq(assignment.id, id)),
      )
      await expect(submitAssignment(toFiles, id, { text: para('x'), fileIds: [] })).rejects.toMatchObject({
        code: 'VALIDATION',
        details: { reason: 'files_required' },
      })

      const closing = await makeAssignment(algo.id, lecturer, { latePolicy: 'accept' })
      const toClosed = racing(alice, () =>
        db
          .update(assignment)
          .set({ latePolicy: 'close', dueAt: new Date(BASE.getTime() - HOUR) })
          .where(eq(assignment.id, closing)),
      )
      await expect(submitAssignment(toClosed, closing, { text: para('x'), fileIds: [] })).rejects.toMatchObject({
        code: 'CONFLICT',
        details: { reason: 'closed' },
      })
      expect(await submissionsOf(id)).toHaveLength(0)
      expect(await submissionsOf(closing)).toHaveLength(0)

      // Moving the deadline into the past with `accept` flags the work late, by the locked row.
      const moving = await makeAssignment(algo.id, lecturer)
      const toPast = racing(alice, () =>
        db.update(assignment).set({ dueAt: new Date(BASE.getTime() - HOUR) }).where(eq(assignment.id, moving)),
      )
      expect(await submitAssignment(toPast, moving, { text: para('x'), fileIds: [] })).toEqual({
        submittedAt: BASE,
        isLate: true,
      })
    })

    it('refuses the student’s own confirmed file uploaded for another purpose (VALIDATION)', async () => {
      const { lecturer, algo, alice } = await setup()
      const id = await makeAssignment(algo.id, lecturer)
      // Owned by Alice, confirmed, under this assignment's submission prefix: only the purpose is wrong.
      const wrongPurpose = await makeFile(alice, id)
      await db.update(file).set({ purpose: 'assignment' }).where(eq(file.id, wrongPurpose))

      await expect(submitAssignment(alice, id, { text: para('x'), fileIds: [wrongPurpose] })).rejects.toMatchObject({
        code: 'VALIDATION',
        details: { reason: 'files' },
      })
      expect(await submissionsOf(id)).toHaveLength(0)
    })

    it('hides the mark and feedback until grades are released', async () => {
      const { lecturer, algo, alice } = await setup()
      const id = await makeAssignment(algo.id, lecturer)
      await submitAssignment(alice, id, { text: para('Answer'), fileIds: [] })
      await grade(id, alice, lecturer, 15.5, 'Good work')

      const before = await getAssignmentForStudent(alice, id)
      expect(before.mySubmission).toMatchObject({ mark: null, feedback: null })
      expect((await listMyAssignments(alice))[0]).toMatchObject({ state: 'submitted', mark: null })

      await release(id)
      const after = await getAssignmentForStudent(alice, id)
      expect(after.mySubmission).toMatchObject({ mark: 15.5, feedback: 'Good work' })
      expect((await listMyAssignments(alice))[0]).toMatchObject({ state: 'graded', mark: 15.5, maxMark: 20 })
    })

    it('clears the grade when the student resubmits after grading', async () => {
      const { lecturer, algo, alice } = await setup()
      const id = await makeAssignment(algo.id, lecturer)
      await submitAssignment(alice, id, { text: para('Answer'), fileIds: [] })
      await grade(id, alice, lecturer, 12, 'OK')
      await release(id)

      await submitAssignment(alice, id, { text: para('Better answer'), fileIds: [] })
      const [row] = await submissionsOf(id)
      expect(row).toMatchObject({ mark: null, feedback: null, gradedAt: null, gradedBy: null })
      expect((await getAssignmentForStudent(alice, id)).mySubmission).toMatchObject({ mark: null, feedback: null })
      expect((await listMyAssignments(alice))[0]).toMatchObject({ state: 'submitted', mark: null })
    })
  })

  describe('listMyAssignments', () => {
    it('derives each state, lists published work of rostered courses only, in due date order', async () => {
      const { lecturer, algo, db2, alice, bob } = await setup()
      const other = ctxFor(db, await makeUser(db, { role: 'lecturer', name: 'Dr Other' }))
      const sch = await createSchool(other, { name: 'Other School', town: 'Douala' })
      const cls = await createClass(other, { schoolId: sch.id, name: 'Other', academicYear: '2026/27' })
      const foreign = await createCourse(other, { classId: cls.id, title: 'Foreign', semester: 1 })

      const at = (h: number) => new Date(BASE.getTime() + h * HOUR)
      const graded = await makeAssignment(algo.id, lecturer, { title: 'Graded', dueAt: at(10) })
      const late = await makeAssignment(algo.id, lecturer, { title: 'Late', dueAt: at(2) })
      const submitted = await makeAssignment(db2.id, lecturer, { title: 'Submitted', dueAt: at(30) })
      const closed = await makeAssignment(db2.id, lecturer, { title: 'Closed', dueAt: at(1), latePolicy: 'close' })
      const todoPast = await makeAssignment(algo.id, lecturer, { title: 'Todo past', dueAt: at(3) })
      const todo = await makeAssignment(algo.id, lecturer, { title: 'Todo', dueAt: at(40) })
      await makeAssignment(algo.id, lecturer, { title: 'Draft', dueAt: at(5), status: 'draft' })
      await makeAssignment(foreign.id, other, { title: 'Foreign', dueAt: at(5) })

      await submitAssignment(alice, graded, { text: para('g'), fileIds: [] })
      await submitAssignment(alice, submitted, { text: para('s'), fileIds: [] })
      await grade(graded, alice, lecturer, 18, null)
      await release(graded)
      // Bob's work never changes Alice's states.
      await submitAssignment(bob, todo, { text: para('b'), fileIds: [] })
      setClock(at(5))
      await submitAssignment(alice, late, { text: para('l'), fileIds: [] })

      const list = await listMyAssignments(alice)
      expect(list.map((a) => [a.title, a.state, a.mark])).toEqual([
        ['Closed', 'closed', null],
        ['Late', 'late', null],
        ['Todo past', 'todo', null],
        ['Graded', 'graded', 18],
        ['Submitted', 'submitted', null],
        ['Todo', 'todo', null],
      ])
      expect(list.find((a) => a.id === closed)).toEqual({
        id: closed,
        courseId: db2.id,
        courseTitle: 'Databases',
        title: 'Closed',
        dueAt: at(1),
        state: 'closed',
        mark: null,
        maxMark: 20,
      })
      expect(list.map((a) => a.id)).toEqual([closed, late, todoPast, graded, submitted, todo])

      const algoOnly = await listMyAssignments(alice, { courseId: algo.id })
      expect(algoOnly.map((a) => a.title)).toEqual(['Late', 'Todo past', 'Graded', 'Todo'])
      expect(await listMyAssignments(alice, { courseId: foreign.id })).toEqual([])
    })

    it('dueWithinDays keeps work due from now until that many days ahead', async () => {
      const { lecturer, algo, alice } = await setup()
      const at = (h: number) => new Date(BASE.getTime() + h * HOUR)
      await makeAssignment(algo.id, lecturer, { title: 'Past', dueAt: at(-1) })
      await makeAssignment(algo.id, lecturer, { title: 'Soon', dueAt: at(1) })
      await makeAssignment(algo.id, lecturer, { title: 'Edge', dueAt: at(7 * 24) })
      await makeAssignment(algo.id, lecturer, { title: 'Far', dueAt: at(7 * 24 + 1) })

      expect((await listMyAssignments(alice, { dueWithinDays: 7 })).map((a) => a.title)).toEqual(['Soon', 'Edge'])
      expect((await listMyAssignments(alice)).map((a) => a.title)).toEqual(['Past', 'Soon', 'Edge', 'Far'])
      for (const dueWithinDays of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
        await expect(listMyAssignments(alice, { dueWithinDays })).rejects.toMatchObject({ code: 'VALIDATION' })
      }
    })
  })
})
