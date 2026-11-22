import { eq } from 'drizzle-orm'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { setMarkingQueueForTests, type MarkingMessage } from '@/server/assignments/ai/queue'
import { createClass, joinClassAsLecturer, joinClassAsStudent } from '@/server/classes/service'
import type { Ctx } from '@/server/core/context'
import { AppError } from '@/server/core/errors'
import { createCourse } from '@/server/courses/service'
import {
  aiUsage,
  assignment,
  class_,
  classLecturer,
  classStudent,
  course,
  school,
  submission,
  user,
} from '@/server/db/schema'
import { createSchool } from '@/server/schools/service'
import { createTestDb } from '@/test/db'
import { ctxFor, makeUser } from '@/test/factories'

let current: Ctx | null = null
vi.mock('@/server/auth/session', () => ({
  getCtx: async () => {
    if (!current) throw new AppError('UNAUTHENTICATED', 'Not signed in')
    return current
  },
}))
const revalidatePath = vi.fn()
vi.mock('next/cache', () => ({
  revalidatePath: (path: string, type?: string) => revalidatePath(path, type),
}))

import { suggestMarksAction } from '@/app/(app)/courses/assignment-actions'

const NOW = new Date('2026-11-21T10:00:00Z')
const SUBMITTED = new Date('2026-11-20T00:00:00Z')
const para = (text: string) => [{ type: 'paragraph', content: [{ type: 'text', text, styles: {} }] }]

describe('suggestMarksAction', () => {
  let db: Awaited<ReturnType<typeof createTestDb>>
  let sent: MarkingMessage[]
  let owner: Ctx
  let colleague: Ctx
  let assignmentId: string

  beforeAll(async () => {
    db = await createTestDb()
  })

  beforeEach(async () => {
    sent = []
    setMarkingQueueForTests({
      async send(m) {
        sent.push(m)
      },
    })
    vi.stubEnv('AI_ASSIGNMENT_MODEL', 'fake')
    vi.stubEnv('AI_MONTHLY_CAP', '3000')

    owner = ctxFor(db, await makeUser(db, { role: 'lecturer', name: 'Dr Owner' }))
    const sch = await createSchool(owner, { name: 'University of Buea', town: 'Buea' })
    const cls = await createClass(owner, { schoolId: sch.id, name: 'CS L3', academicYear: '2026/27' })
    colleague = ctxFor(db, await makeUser(db, { role: 'lecturer', name: 'Dr Colleague' }))
    await joinClassAsLecturer(colleague, cls.lecturerCode!)
    const crs = await createCourse(owner, { classId: cls.id, title: 'Algorithms', semester: 1 })

    const student = async (name: string, matricule: string) => {
      const s = ctxFor(db, await makeUser(db, { role: 'student', name }))
      await joinClassAsStudent(s, cls.studentCode!, matricule)
      return s
    }
    const alice = await student('Alice', 'UB1')
    const bob = await student('Bob', 'UB2')
    const carol = await student('Carol', 'UB3')

    const [a] = await db
      .insert(assignment)
      .values({
        courseId: crs.id,
        title: 'Sorting homework',
        instructions: para('Explain quicksort'),
        dueAt: new Date('2026-12-01T00:00:00Z'),
        maxMark: 20,
        submissionMode: 'both',
        status: 'published',
        publishedAt: NOW,
        createdBy: owner.user.id,
      })
      .returning({ id: assignment.id })
    assignmentId = a.id

    await db.insert(submission).values([
      { assignmentId, studentId: alice.user.id, text: para('Answer by Alice'), submittedAt: SUBMITTED },
      { assignmentId, studentId: bob.user.id, text: para('Answer by Bob'), submittedAt: SUBMITTED },
      { assignmentId, studentId: carol.user.id, text: para('Answer by Carol'), submittedAt: SUBMITTED, mark: 15 },
    ])
  })

  afterEach(async () => {
    current = null
    setMarkingQueueForTests(null)
    vi.unstubAllEnvs()
    revalidatePath.mockReset()
    await db.delete(aiUsage)
    await db.delete(submission)
    await db.delete(assignment)
    await db.delete(course)
    await db.delete(classStudent)
    await db.delete(classLecturer)
    await db.delete(class_)
    await db.delete(school)
    await db.delete(user)
  })

  it('queues the eligible submissions, reports the count and refreshes the assignment pages', async () => {
    current = owner
    expect(await suggestMarksAction(assignmentId)).toEqual({ ok: true, data: { queued: 2 } })
    expect(sent).toHaveLength(2)
    expect(revalidatePath).toHaveBeenCalledWith('/courses/[courseId]/assignments/[assignmentId]', 'page')

    // A second press finds nothing left to queue.
    sent = []
    expect(await suggestMarksAction(assignmentId)).toEqual({ ok: true, data: { queued: 0 } })
    expect(sent).toEqual([])
  })

  it('refuses a signed-out caller and a malformed assignment id', async () => {
    expect(await suggestMarksAction(assignmentId)).toEqual({ ok: false, code: 'UNAUTHENTICATED' })
    current = owner
    expect(await suggestMarksAction('')).toEqual({ ok: false, code: 'VALIDATION', details: { fields: ['assignmentId'] } })
    expect(await suggestMarksAction('x'.repeat(101))).toEqual({
      ok: false,
      code: 'VALIDATION',
      details: { fields: ['assignmentId'] },
    })
    expect(sent).toEqual([])
  })

  it('refuses anyone but the course owner', async () => {
    current = colleague
    expect(await suggestMarksAction(assignmentId)).toMatchObject({ ok: false, code: 'FORBIDDEN' })
    expect(sent).toEqual([])
  })

  it('refuses a draft assignment', async () => {
    await db.update(assignment).set({ status: 'draft', publishedAt: null }).where(eq(assignment.id, assignmentId))
    current = owner
    expect(await suggestMarksAction(assignmentId)).toMatchObject({
      ok: false,
      code: 'CONFLICT',
      details: { reason: 'not_published' },
    })
    expect(sent).toEqual([])
  })

  it('reports AI being off and the monthly cap as conflicts', async () => {
    current = owner
    vi.stubEnv('AI_ASSIGNMENT_MODEL', '')
    vi.stubEnv('AI_AWS_ROLE_ARN', '')
    expect(await suggestMarksAction(assignmentId)).toMatchObject({
      ok: false,
      code: 'CONFLICT',
      details: { reason: 'ai_off' },
    })

    vi.stubEnv('AI_ASSIGNMENT_MODEL', 'fake')
    vi.stubEnv('AI_MONTHLY_CAP', '1')
    await db.insert(aiUsage).values({
      purpose: 'assignment_marking',
      lecturerId: owner.user.id,
      model: 'm',
      ok: true,
      createdAt: new Date(),
    })
    expect(await suggestMarksAction(assignmentId)).toMatchObject({
      ok: false,
      code: 'CONFLICT',
      details: { reason: 'cap' },
    })
    expect(sent).toEqual([])
  })
})
