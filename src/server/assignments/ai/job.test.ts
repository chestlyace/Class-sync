import { eq } from 'drizzle-orm'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { setNowForTests } from '@/server/core/clock'
import type { Ctx } from '@/server/core/context'
import type { Db } from '@/server/db'
import {
  aiUsage,
  assignment,
  class_,
  classLecturer,
  classStudent,
  course,
  file,
  school,
  submission,
  submissionFile,
  user,
} from '@/server/db/schema'
import { createClass, joinClassAsStudent } from '@/server/classes/service'
import { createCourse } from '@/server/courses/service'
import { createSchool } from '@/server/schools/service'
import { createTestDb } from '@/test/db'
import { ctxFor, makeUser } from '@/test/factories'
import { gradeSubmission } from '../lecturer'
import { runMarkingJob } from './job'
import type { MarkingMessage } from './queue'
import { AssignmentSuggesterError, type AssignmentSuggester, type MarkingSuggestion } from './suggester'

const NOW = new Date('2026-11-21T10:00:00Z')
const SUBMITTED = new Date('2026-11-20T00:00:00Z')
const para = (text: string) => [{ type: 'paragraph', content: [{ type: 'text', text, styles: {} }] }]

const SUGGESTION: MarkingSuggestion = {
  mark: 14.5,
  feedback: 'Good pivot discussion.',
  transcript: 'Quicksort picks a pivot.',
  inputTokens: 1200,
  outputTokens: 300,
  model: 'test-model',
}

function stub(result: MarkingSuggestion = SUGGESTION) {
  return vi.fn<AssignmentSuggester>(async () => result)
}

describe('runMarkingJob', () => {
  let db: Db

  beforeAll(async () => {
    db = await createTestDb()
  })
  beforeEach(() => {
    setNowForTests(() => NOW)
    vi.stubEnv('AI_ASSIGNMENT_MODEL', 'fake')
    vi.stubEnv('AI_MONTHLY_CAP', '3000')
  })
  afterEach(async () => {
    setNowForTests(null)
    vi.unstubAllEnvs()
    vi.restoreAllMocks()
    await db.delete(aiUsage)
    await db.delete(submissionFile)
    await db.delete(submission)
    await db.delete(assignment)
    await db.delete(file)
    await db.delete(course)
    await db.delete(classStudent)
    await db.delete(classLecturer)
    await db.delete(class_)
    await db.delete(school)
    await db.delete(user)
  })

  async function seed(opts: { text?: unknown; aiStatus?: 'queued' | 'failed' | null } = {}) {
    const lecturer: Ctx = ctxFor(db, await makeUser(db, { role: 'lecturer', name: 'Dr Owner' }))
    const sch = await createSchool(lecturer, { name: 'University of Buea', town: 'Buea' })
    const cls = await createClass(lecturer, { schoolId: sch.id, name: 'CS L3', academicYear: '2026/27' })
    const crs = await createCourse(lecturer, { classId: cls.id, title: 'Algorithms', semester: 1 })
    const student = ctxFor(db, await makeUser(db, { role: 'student', name: 'Alice' }))
    await joinClassAsStudent(student, cls.studentCode!, 'UB1')
    const [a] = await db
      .insert(assignment)
      .values({
        courseId: crs.id,
        title: 'Sorting homework',
        instructions: para('Explain quicksort'),
        markingGuide: 'Mention pivot choice',
        dueAt: new Date('2026-12-01T00:00:00Z'),
        maxMark: 20,
        submissionMode: 'both',
        status: 'published',
        publishedAt: new Date('2026-11-10T00:00:00Z'),
        createdBy: lecturer.user.id,
      })
      .returning({ id: assignment.id })
    const [s] = await db
      .insert(submission)
      .values({
        assignmentId: a.id,
        studentId: student.user.id,
        text: opts.text === undefined ? para('Quicksort picks a pivot.') : opts.text,
        submittedAt: SUBMITTED,
        aiStatus: opts.aiStatus === undefined ? 'queued' : opts.aiStatus,
        aiStatusAt: new Date('2026-11-21T09:59:00Z'),
      })
      .returning({ id: submission.id })
    const message: MarkingMessage = {
      submissionId: s.id,
      submittedAt: SUBMITTED.toISOString(),
      requestedAt: '2026-11-21T09:59:00.000Z',
    }
    return { lecturer, student, assignmentId: a.id, submissionId: s.id, message }
  }

  const readSub = async (id: string) => (await db.select().from(submission).where(eq(submission.id, id)))[0]
  const usageRows = () => db.select().from(aiUsage)

  it('stores the suggestion as Clasync, clears the status and records one successful call', async () => {
    const s = await seed()
    const suggester = stub()
    expect(await runMarkingJob(db, s.message, suggester)).toBe('stored')
    expect(suggester).toHaveBeenCalledTimes(1)
    expect(suggester.mock.calls[0][0]).toMatchObject({ studentText: 'Quicksort picks a pivot.', maxMark: 20 })
    const row = await readSub(s.submissionId)
    expect(row).toMatchObject({
      mark: null,
      suggestedMark: 14.5,
      suggestedFeedback: 'Good pivot discussion.',
      suggestedBy: 'clasync',
      suggestedTranscript: 'Quicksort picks a pivot.',
      suggestedUnread: null,
      aiStatus: null,
      aiStatusAt: null,
      aiError: null,
    })
    expect(row.suggestedAt).toEqual(NOW)
    const usage = await usageRows()
    expect(usage).toHaveLength(1)
    expect(usage[0]).toMatchObject({
      purpose: 'assignment_marking',
      lecturerId: s.lecturer.user.id,
      submissionId: s.submissionId,
      model: 'test-model',
      inputTokens: 1200,
      outputTokens: 300,
      ok: true,
    })
  })

  it('keeps the list of unread files with the suggestion', async () => {
    const s = await seed()
    const [heic] = await db
      .insert(file)
      .values({
        ownerId: s.student.user.id,
        purpose: 'submission',
        storageKey: `submission/${crypto.randomUUID()}/x.heic`,
        name: 'x.heic',
        mimeType: 'image/heic',
        sizeBytes: 1000,
        confirmedAt: SUBMITTED,
      })
      .returning()
    await db.insert(submissionFile).values({ submissionId: s.submissionId, fileId: heic.id, position: 0 })
    expect(await runMarkingJob(db, s.message, stub())).toBe('stored')
    expect((await readSub(s.submissionId)).suggestedUnread).toEqual([{ position: 1, reason: 'heic' }])
  })

  it('does not store the suggestion when the lecturer grades while the model is working', async () => {
    const s = await seed()
    const suggester = vi.fn<AssignmentSuggester>(async () => {
      await gradeSubmission(s.lecturer, s.submissionId, { mark: 12, feedback: 'Mine', expectedSubmittedAt: SUBMITTED })
      return SUGGESTION
    })
    expect(await runMarkingJob(db, s.message, suggester)).toBe('skipped')
    const row = await readSub(s.submissionId)
    expect(row).toMatchObject({
      mark: 12,
      feedback: 'Mine',
      suggestedMark: null,
      suggestedFeedback: null,
      suggestedAt: null,
      suggestedBy: null,
      suggestedTranscript: null,
      aiStatus: null,
    })
  })

  it('skips a message about an older hand-in and writes nothing; the new version still gets its suggestion', async () => {
    const s = await seed()
    const NEWER = new Date('2026-11-21T08:00:00Z')
    // New hand-in, then a new request queued the new version.
    await db
      .update(submission)
      .set({ submittedAt: NEWER, text: para('Second try'), aiStatus: 'queued', aiStatusAt: NOW })
      .where(eq(submission.id, s.submissionId))
    const before = await readSub(s.submissionId)
    const suggester = stub()
    expect(await runMarkingJob(db, s.message, suggester)).toBe('skipped')
    expect(suggester).not.toHaveBeenCalled()
    expect(await readSub(s.submissionId)).toEqual(before)
    expect(await usageRows()).toHaveLength(0)

    const fresh = { ...s.message, submittedAt: NEWER.toISOString() }
    expect(await runMarkingJob(db, fresh, suggester)).toBe('stored')
    expect(suggester.mock.calls[0][0].studentText).toBe('Second try')
  })

  it('skips a submission that is gone or graded', async () => {
    const suggester = stub()
    expect(await runMarkingJob(db, { submissionId: 'nope', submittedAt: SUBMITTED.toISOString(), requestedAt: NOW.toISOString() }, suggester)).toBe('skipped')

    const graded = await seed()
    await db.update(submission).set({ mark: 10 }).where(eq(submission.id, graded.submissionId))
    expect(await runMarkingJob(db, graded.message, suggester)).toBe('skipped')
    expect(await readSub(graded.submissionId)).toMatchObject({ mark: 10, aiStatus: 'queued', suggestedAt: null })

    expect(suggester).not.toHaveBeenCalled()
    expect(await usageRows()).toHaveLength(0)
  })

  it('skips a submission that is no longer queued', async () => {
    const suggester = stub()
    const notQueued = await seed({ aiStatus: null })
    expect(await runMarkingJob(db, notQueued.message, suggester)).toBe('skipped')
    expect(await readSub(notQueued.submissionId)).toMatchObject({ aiStatus: null, suggestedAt: null })
    expect(suggester).not.toHaveBeenCalled()
    expect(await usageRows()).toHaveLength(0)
  })

  it('fails with cap, without calling the model, once the month has used the cap', async () => {
    vi.stubEnv('AI_MONTHLY_CAP', '1')
    const s = await seed()
    await db.insert(aiUsage).values({
      purpose: 'assignment_marking',
      lecturerId: s.lecturer.user.id,
      submissionId: null,
      model: 'test-model',
      ok: true,
      createdAt: new Date('2026-11-02T00:00:00Z'),
    })
    const suggester = stub()
    expect(await runMarkingJob(db, s.message, suggester)).toBe('failed')
    expect(suggester).not.toHaveBeenCalled()
    expect(await readSub(s.submissionId)).toMatchObject({ aiStatus: 'failed', aiError: 'cap', aiStatusAt: NOW, suggestedAt: null })
    expect(await usageRows()).toHaveLength(1)
  })

  it('does not count last month toward the cap', async () => {
    vi.stubEnv('AI_MONTHLY_CAP', '1')
    const s = await seed()
    await db.insert(aiUsage).values({
      purpose: 'assignment_marking',
      lecturerId: s.lecturer.user.id,
      model: 'test-model',
      ok: true,
      createdAt: new Date('2026-10-31T23:59:59Z'),
    })
    expect(await runMarkingJob(db, s.message, stub())).toBe('stored')
  })

  it('fails with provider and records a failed call when the model errors, without throwing', async () => {
    const s = await seed()
    const errorLog = vi.spyOn(console, 'error').mockImplementation(() => {})
    const suggester = vi.fn<AssignmentSuggester>(async () => {
      throw new AssignmentSuggesterError('APICallError', 'rate_limit', 429)
    })
    expect(await runMarkingJob(db, s.message, suggester)).toBe('failed')
    expect(await readSub(s.submissionId)).toMatchObject({ aiStatus: 'failed', aiError: 'provider', aiStatusAt: NOW, suggestedAt: null })
    const usage = await usageRows()
    expect(usage).toHaveLength(1)
    expect(usage[0]).toMatchObject({ ok: false, submissionId: s.submissionId, lecturerId: s.lecturer.user.id, inputTokens: 0, outputTokens: 0 })
    expect(errorLog).toHaveBeenCalledWith('[ai-marking] suggestion failed', 'rate_limit')
  })

  it('fails with provider when no model is configured', async () => {
    const s = await seed()
    expect(await runMarkingJob(db, s.message, null)).toBe('failed')
    expect(await readSub(s.submissionId)).toMatchObject({ aiStatus: 'failed', aiError: 'provider' })
    expect(await usageRows()).toHaveLength(0)
  })

  it('fails with unreadable, without calling the model, when there is only a HEIC photo and no text', async () => {
    const s = await seed({ text: null })
    const [heic] = await db
      .insert(file)
      .values({
        ownerId: s.student.user.id,
        purpose: 'submission',
        storageKey: `submission/${crypto.randomUUID()}/photo.heic`,
        name: 'photo.heic',
        mimeType: 'image/heic',
        sizeBytes: 1000,
        confirmedAt: SUBMITTED,
      })
      .returning()
    await db.insert(submissionFile).values({ submissionId: s.submissionId, fileId: heic.id, position: 0 })
    const suggester = stub()
    expect(await runMarkingJob(db, s.message, suggester)).toBe('failed')
    expect(suggester).not.toHaveBeenCalled()
    expect(await readSub(s.submissionId)).toMatchObject({ aiStatus: 'failed', aiError: 'unreadable' })
    expect(await usageRows()).toHaveLength(0)
  })
})
