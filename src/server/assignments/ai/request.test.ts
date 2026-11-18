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
  courseRosterAdjustment,
  school,
  submission,
  user,
} from '@/server/db/schema'
import { createClass, joinClassAsLecturer, joinClassAsStudent } from '@/server/classes/service'
import { createCourse, setRosterAdjustment } from '@/server/courses/service'
import { createSchool } from '@/server/schools/service'
import { createTestDb } from '@/test/db'
import { ctxFor, makeUser } from '@/test/factories'
import { runMarkingJob } from './job'
import { setMarkingQueueForTests, type MarkingMessage } from './queue'
import { requestMarkingSuggestions, requestOneSuggestion } from './request'
import type { AssignmentSuggester } from './suggester'

const NOW = new Date('2026-11-21T10:00:00Z')
const SUBMITTED = new Date('2026-11-20T00:00:00Z')
const para = (text: string) => [{ type: 'paragraph', content: [{ type: 'text', text, styles: {} }] }]

describe('AI marking requests', () => {
  let db: Db
  let sent: MarkingMessage[]

  beforeAll(async () => {
    db = await createTestDb()
  })
  beforeEach(() => {
    sent = []
    setMarkingQueueForTests({
      async send(m) {
        sent.push(m)
      },
    })
    setNowForTests(() => NOW)
    vi.stubEnv('AI_ASSIGNMENT_MODEL', 'fake')
    vi.stubEnv('AI_MONTHLY_CAP', '3000')
  })
  afterEach(async () => {
    setMarkingQueueForTests(null)
    setNowForTests(null)
    vi.unstubAllEnvs()
    await db.delete(aiUsage)
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

  async function setup(opts: { status?: 'draft' | 'published' } = {}) {
    const lecturer: Ctx = ctxFor(db, await makeUser(db, { role: 'lecturer', name: 'Dr Owner' }))
    const sch = await createSchool(lecturer, { name: 'University of Buea', town: 'Buea' })
    const cls = await createClass(lecturer, { schoolId: sch.id, name: 'CS L3', academicYear: '2026/27' })
    const colleague = ctxFor(db, await makeUser(db, { role: 'lecturer', name: 'Dr Colleague' }))
    await joinClassAsLecturer(colleague, cls.lecturerCode!)
    const crs = await createCourse(lecturer, { classId: cls.id, title: 'Algorithms', semester: 1 })
    const student = async (name: string, matricule: string) => {
      const s = ctxFor(db, await makeUser(db, { role: 'student', name }))
      await joinClassAsStudent(s, cls.studentCode!, matricule)
      return s
    }
    const published = (opts.status ?? 'published') === 'published'
    const [a] = await db
      .insert(assignment)
      .values({
        courseId: crs.id,
        title: 'Sorting homework',
        instructions: para('Explain quicksort'),
        dueAt: new Date('2026-12-01T00:00:00Z'),
        maxMark: 20,
        submissionMode: 'both',
        status: published ? 'published' : 'draft',
        publishedAt: published ? new Date('2026-11-10T00:00:00Z') : null,
        createdBy: lecturer.user.id,
      })
      .returning({ id: assignment.id })
    const submit = async (s: Ctx, over: Partial<typeof submission.$inferInsert> = {}) => {
      const [row] = await db
        .insert(submission)
        .values({
          assignmentId: a.id,
          studentId: s.user.id,
          text: para(`Answer by ${s.user.name}`),
          submittedAt: SUBMITTED,
          ...over,
        })
        .returning({ id: submission.id })
      return row.id
    }
    return { lecturer, colleague, courseId: crs.id, assignmentId: a.id, student, submit }
  }

  const readSub = async (id: string) => (await db.select().from(submission).where(eq(submission.id, id)))[0]

  describe('requestMarkingSuggestions', () => {
    it('queues only ungraded, unsuggested, not-queued submissions of roster students', async () => {
      const t = await setup()
      const fresh = await t.submit(await t.student('Alice', 'UB1'))
      const graded = await t.submit(await t.student('Bob', 'UB2'), { mark: 15 })
      const suggested = await t.submit(await t.student('Carol', 'UB3'), {
        suggestedMark: 10,
        suggestedAt: SUBMITTED,
        suggestedBy: 'assistant',
      })
      const queued = await t.submit(await t.student('Dave', 'UB4'), { aiStatus: 'queued', aiStatusAt: SUBMITTED })
      const failed = await t.submit(await t.student('Eve', 'UB5'), {
        aiStatus: 'failed',
        aiStatusAt: SUBMITTED,
        aiError: 'provider',
      })
      const frank = await t.student('Frank', 'UB6')
      const offRoster = await t.submit(frank)
      await setRosterAdjustment(t.lecturer, t.courseId, frank.user.id, 'exclude')

      expect(await requestMarkingSuggestions(t.lecturer, t.assignmentId)).toEqual({ queued: 2 })

      expect(sent.map((m) => m.submissionId).sort()).toEqual([fresh, failed].sort())
      for (const m of sent) {
        expect(m).toEqual({ submissionId: m.submissionId, submittedAt: SUBMITTED.toISOString(), requestedAt: NOW.toISOString() })
      }
      for (const id of [fresh, failed]) {
        expect(await readSub(id)).toMatchObject({ aiStatus: 'queued', aiStatusAt: NOW, aiError: null })
      }
      expect(await readSub(graded)).toMatchObject({ aiStatus: null })
      expect(await readSub(suggested)).toMatchObject({ aiStatus: null, suggestedMark: 10 })
      expect(await readSub(queued)).toMatchObject({ aiStatus: 'queued', aiStatusAt: SUBMITTED })
      expect(await readSub(offRoster)).toMatchObject({ aiStatus: null })

      // Nothing left to queue on a second press.
      sent = []
      expect(await requestMarkingSuggestions(t.lecturer, t.assignmentId)).toEqual({ queued: 0 })
      expect(sent).toEqual([])
    })

    it('refuses anyone but the course owner', async () => {
      const t = await setup()
      await t.submit(await t.student('Alice', 'UB1'))
      await expect(requestMarkingSuggestions(t.colleague, t.assignmentId)).rejects.toMatchObject({ code: 'FORBIDDEN' })
      expect(sent).toEqual([])
    })

    it('refuses a draft assignment', async () => {
      const t = await setup({ status: 'draft' })
      await expect(requestMarkingSuggestions(t.lecturer, t.assignmentId)).rejects.toMatchObject({
        code: 'CONFLICT',
        details: { reason: 'not_published' },
      })
    })

    it('refuses when AI marking is off', async () => {
      vi.stubEnv('AI_ASSIGNMENT_MODEL', '')
      vi.stubEnv('AI_AWS_ROLE_ARN', '')
      const t = await setup()
      const id = await t.submit(await t.student('Alice', 'UB1'))
      await expect(requestMarkingSuggestions(t.lecturer, t.assignmentId)).rejects.toMatchObject({
        code: 'CONFLICT',
        details: { reason: 'ai_off' },
      })
      expect(await readSub(id)).toMatchObject({ aiStatus: null })
      expect(sent).toEqual([])
    })

    it('refuses and queues nothing once the monthly cap is reached', async () => {
      vi.stubEnv('AI_MONTHLY_CAP', '1')
      const t = await setup()
      const id = await t.submit(await t.student('Alice', 'UB1'))
      await db.insert(aiUsage).values({ purpose: 'assignment_marking', lecturerId: t.lecturer.user.id, model: 'm', ok: true, createdAt: NOW })
      await expect(requestMarkingSuggestions(t.lecturer, t.assignmentId)).rejects.toMatchObject({
        code: 'CONFLICT',
        details: { reason: 'cap' },
      })
      expect(await readSub(id)).toMatchObject({ aiStatus: null })
      expect(sent).toEqual([])
    })

    it('marks a submission failed when its message cannot be sent, and still queues the others', async () => {
      const t = await setup()
      const a = await t.submit(await t.student('Alice', 'UB1'))
      const b = await t.submit(await t.student('Bob', 'UB2'))
      const errorLog = vi.spyOn(console, 'error').mockImplementation(() => {})
      setMarkingQueueForTests({
        async send(m) {
          if (m.submissionId === b) throw new Error('queue down')
          sent.push(m)
        },
      })
      expect(await requestMarkingSuggestions(t.lecturer, t.assignmentId)).toEqual({ queued: 1 })
      expect(await readSub(a)).toMatchObject({ aiStatus: 'queued' })
      expect(await readSub(b)).toMatchObject({ aiStatus: 'failed', aiError: 'provider' })
      expect(errorLog).toHaveBeenCalled()
      errorLog.mockRestore()
    })
  })

  describe('requestOneSuggestion', () => {
    it('refuses a graded submission', async () => {
      const t = await setup()
      const id = await t.submit(await t.student('Alice', 'UB1'), { mark: 12 })
      await expect(requestOneSuggestion(t.lecturer, id)).rejects.toMatchObject({ code: 'CONFLICT', details: { reason: 'graded' } })
      expect(sent).toEqual([])
    })

    it('refuses anyone but the course owner', async () => {
      const t = await setup()
      const id = await t.submit(await t.student('Alice', 'UB1'))
      await expect(requestOneSuggestion(t.colleague, id)).rejects.toMatchObject({ code: 'FORBIDDEN' })
    })

    it('refuses when AI marking is off or the cap is reached', async () => {
      const t = await setup()
      const id = await t.submit(await t.student('Alice', 'UB1'))
      vi.stubEnv('AI_ASSIGNMENT_MODEL', '')
      vi.stubEnv('AI_AWS_ROLE_ARN', '')
      await expect(requestOneSuggestion(t.lecturer, id)).rejects.toMatchObject({ code: 'CONFLICT', details: { reason: 'ai_off' } })
      vi.stubEnv('AI_ASSIGNMENT_MODEL', 'fake')
      vi.stubEnv('AI_MONTHLY_CAP', '1')
      await db.insert(aiUsage).values({ purpose: 'assignment_marking', lecturerId: t.lecturer.user.id, model: 'm', ok: true, createdAt: NOW })
      await expect(requestOneSuggestion(t.lecturer, id)).rejects.toMatchObject({ code: 'CONFLICT', details: { reason: 'cap' } })
      expect(await readSub(id)).toMatchObject({ aiStatus: null })
      expect(sent).toEqual([])
    })

    it('does nothing when the submission is already queued', async () => {
      const t = await setup()
      const id = await t.submit(await t.student('Alice', 'UB1'), { aiStatus: 'queued', aiStatusAt: SUBMITTED })
      await requestOneSuggestion(t.lecturer, id)
      expect(sent).toEqual([])
      expect(await readSub(id)).toMatchObject({ aiStatus: 'queued', aiStatusAt: SUBMITTED })
    })

    it('clears an existing suggestion, queues the submission, and the job then stores a new one', async () => {
      const t = await setup()
      const id = await t.submit(await t.student('Alice', 'UB1'), {
        suggestedMark: 9,
        suggestedFeedback: 'Old',
        suggestedAt: SUBMITTED,
        suggestedBy: 'assistant',
        suggestedTranscript: 'old transcript',
        suggestedUnread: [{ position: 1, reason: 'heic' }],
      })
      await requestOneSuggestion(t.lecturer, id)
      expect(sent).toEqual([{ submissionId: id, submittedAt: SUBMITTED.toISOString(), requestedAt: NOW.toISOString() }])
      expect(await readSub(id)).toMatchObject({
        suggestedMark: null,
        suggestedFeedback: null,
        suggestedAt: null,
        suggestedBy: null,
        suggestedTranscript: null,
        suggestedUnread: null,
        aiStatus: 'queued',
        aiStatusAt: NOW,
        aiError: null,
      })

      const suggester = vi.fn<AssignmentSuggester>(async () => ({
        mark: 17,
        feedback: 'Fresh',
        transcript: 'Answer by Alice',
        inputTokens: 10,
        outputTokens: 5,
        model: 'test-model',
      }))
      expect(await runMarkingJob(db, sent[0], suggester)).toBe('stored')
      expect(await readSub(id)).toMatchObject({ suggestedMark: 17, suggestedFeedback: 'Fresh', suggestedBy: 'clasync', aiStatus: null })
    })
  })
})
