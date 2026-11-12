import { eq } from 'drizzle-orm'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  getAssignmentForEdit,
  getSubmissionForLecturer,
  gradeSubmission,
  publishAssignment,
  suggestSubmissionMark,
} from '@/server/assignments/lecturer'
import { getAssignmentForStudent, listMyAssignments, submitAssignment } from '@/server/assignments/student'
import type { Db } from '@/server/db'
import { assignment, submission } from '@/server/db/schema'
import { setAfterResponseForTests } from '@/server/lib/after-response'
import { createTestDb } from '@/test/db'
import { clearMarkingData, setupCourse } from '@/test/marking-fixture'
import { callTool, parseToolInput } from '@/test/mcp'

vi.mock('@/server/push/send', () => ({
  sendPush: vi.fn(async () => ({ sent: 0, skipped: 0, failed: 0, removed: 0 })),
  queuePush: vi.fn(async () => {}),
}))

vi.mock('@/server/email/notify', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/server/email/notify')>()
  return { ...actual, sendNotifications: vi.fn(async () => ({ sent: 0, skipped: 0, failed: 0 })) }
})

const DAY = 24 * 60 * 60_000
const inAWeek = () => new Date(Date.now() + 7 * DAY).toISOString()
const para = (text: string) => [{ type: 'paragraph', content: [{ type: 'text', text, styles: {} }], children: [] }]

describe('assignment draft tools', () => {
  let db: Db

  beforeAll(async () => {
    db = await createTestDb()
  })
  beforeEach(() => {
    setAfterResponseForTests(() => {})
    vi.stubEnv('BETTER_AUTH_URL', 'https://clasync.test')
  })
  afterEach(async () => {
    setAfterResponseForTests(null)
    vi.unstubAllEnvs()
    await clearMarkingData(db)
  })

  async function draft(fx: Awaited<ReturnType<typeof setupCourse>>, over: Record<string, unknown> = {}) {
    return (await callTool('create_assignment_draft', fx.lecturer, {
      courseId: fx.bio.id,
      title: 'Osmosis lab',
      instructions: '# Lab\n\nObserve **osmosis** in potato cells.\n\n- Cut\n- Weigh',
      dueAt: inAWeek(),
      ...over,
    })) as { id: string; status: string }
  }

  /** A published assignment with Alice's submission. */
  async function withSubmission(fx: Awaited<ReturnType<typeof setupCourse>>) {
    const { id } = await draft(fx, { maxMark: 20, submissionType: 'text' })
    await publishAssignment(fx.lecturer, id)
    await submitAssignment(fx.alice, id, { text: para('Water moved in.'), fileIds: [] })
    const [sub] = await db.select().from(submission).where(eq(submission.assignmentId, id))
    return { assignmentId: id, sub }
  }

  it('create_assignment_draft makes a draft with the instructions as rich text', async () => {
    const fx = await setupCourse(db)
    const out = (await draft(fx)) as Record<string, unknown>
    expect(out).toMatchObject({ status: 'draft', title: 'Osmosis lab', maxMark: 20, weight: 1, submissionType: 'both' })
    expect(out.note).toMatch(/lecturer reviews and publishes/)
    const detail = await getAssignmentForEdit(fx.lecturer, out.id as string)
    expect(detail.status).toBe('draft')
    expect(detail.publishedAt).toBeNull()
    expect(detail.instructions.map((b) => b.type)).toEqual(['heading', 'paragraph', 'bulletListItem', 'bulletListItem'])
    // Students see nothing of it.
    expect(await listMyAssignments(fx.alice)).toEqual([])
  })

  it('create_assignment_draft: another lecturer is FORBIDDEN; bad input fails the schema', async () => {
    const fx = await setupCourse(db)
    await expect(draft(fx, {})).resolves.toBeDefined()
    await expect(
      callTool('create_assignment_draft', fx.colleague, {
        courseId: fx.bio.id,
        title: 'Mine now',
        instructions: 'x',
        dueAt: inAWeek(),
      }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' })
    expect(parseToolInput('create_assignment_draft', { courseId: 'c', title: 'T', instructions: 'x', dueAt: inAWeek() }).success).toBe(false)
    expect(parseToolInput('create_assignment_draft', { courseId: 'c', title: 'Ok', instructions: 'x', dueAt: 'tomorrow' }).success).toBe(false)
  })

  it('update_assignment_draft changes only the given fields and keeps it a draft', async () => {
    const fx = await setupCourse(db)
    const { id } = await draft(fx)
    const out = (await callTool('update_assignment_draft', fx.lecturer, { assignmentId: id, title: 'Osmosis lab v2', maxMark: 30 })) as Record<string, unknown>
    expect(out).toMatchObject({ status: 'draft', title: 'Osmosis lab v2', maxMark: 30, submissionType: 'both' })
    const detail = await getAssignmentForEdit(fx.lecturer, id)
    expect(detail.instructions[0].type).toBe('heading')
  })

  it('update_assignment_draft refuses a published assignment (CONFLICT) and another lecturer (FORBIDDEN)', async () => {
    const fx = await setupCourse(db)
    const { id } = await draft(fx)
    await expect(callTool('update_assignment_draft', fx.colleague, { assignmentId: id, title: 'Taken' })).rejects.toMatchObject({
      code: 'FORBIDDEN',
    })
    await publishAssignment(fx.lecturer, id)
    await expect(callTool('update_assignment_draft', fx.lecturer, { assignmentId: id, title: 'Changed' })).rejects.toMatchObject({
      code: 'CONFLICT',
      details: { reason: 'published' },
    })
    const [row] = await db.select().from(assignment).where(eq(assignment.id, id))
    expect(row.title).toBe('Osmosis lab')
  })

  it('suggest_assignment_grade stores a suggestion, never the mark, and the lecturer view shows it', async () => {
    const fx = await setupCourse(db)
    const { sub } = await withSubmission(fx)
    const out = (await callTool('suggest_assignment_grade', fx.lecturer, {
      submissionId: sub.id,
      mark: 14.5,
      feedback: '  Clear method; weigh before and after.  ',
    })) as Record<string, unknown>
    expect(out).toMatchObject({ suggestedMark: 14.5, suggestedFeedback: 'Clear method; weigh before and after.' })

    const [row] = await db.select().from(submission).where(eq(submission.id, sub.id))
    expect(row).toMatchObject({ mark: null, feedback: null, gradedAt: null, suggestedMark: 14.5 })
    const view = await getSubmissionForLecturer(fx.lecturer, sub.id)
    expect(view.mark).toBeNull()
    expect(view.suggestion).toMatchObject({ mark: 14.5, feedback: 'Clear method; weigh before and after.' })
  })

  it('suggest_assignment_grade: graded → CONFLICT, other lecturer → FORBIDDEN, bad mark → VALIDATION', async () => {
    const fx = await setupCourse(db)
    const { sub } = await withSubmission(fx)
    await expect(callTool('suggest_assignment_grade', fx.colleague, { submissionId: sub.id, mark: 10 })).rejects.toMatchObject({
      code: 'FORBIDDEN',
    })
    await expect(callTool('suggest_assignment_grade', fx.lecturer, { submissionId: sub.id, mark: 20.25 })).rejects.toMatchObject({
      code: 'VALIDATION',
      details: { fields: ['mark'] },
    })
    expect(parseToolInput('suggest_assignment_grade', { submissionId: sub.id, mark: 3.1 }).success).toBe(false)
    expect(parseToolInput('suggest_assignment_grade', { submissionId: sub.id, mark: -1 }).success).toBe(false)

    await gradeSubmission(fx.lecturer, sub.id, { mark: 12, feedback: null, expectedSubmittedAt: sub.submittedAt })
    await expect(callTool('suggest_assignment_grade', fx.lecturer, { submissionId: sub.id, mark: 10 })).rejects.toMatchObject({
      code: 'CONFLICT',
      details: { reason: 'graded' },
    })
    const [row] = await db.select().from(submission).where(eq(submission.id, sub.id))
    expect(row.mark).toBe(12)
    expect(row.suggestedMark).toBeNull()
  })

  it('saving a grade clears the suggestion; a resubmission clears it too', async () => {
    const fx = await setupCourse(db)
    const { assignmentId, sub } = await withSubmission(fx)
    await suggestSubmissionMark(fx.lecturer, sub.id, { mark: 15, feedback: 'Good' })
    await gradeSubmission(fx.lecturer, sub.id, { mark: 16, feedback: 'Very good', expectedSubmittedAt: sub.submittedAt })
    let row = (await db.select().from(submission).where(eq(submission.id, sub.id)))[0]
    expect(row).toMatchObject({ mark: 16, suggestedMark: null, suggestedFeedback: null, suggestedAt: null })
    expect((await getSubmissionForLecturer(fx.lecturer, sub.id)).suggestion).toBeNull()

    await submitAssignment(fx.bob, assignmentId, { text: para('v1'), fileIds: [] })
    const [bobSub] = await db.select().from(submission).where(eq(submission.studentId, fx.bob.user.id))
    await suggestSubmissionMark(fx.lecturer, bobSub.id, { mark: 8, feedback: null })
    await new Promise((r) => setTimeout(r, 5))
    await submitAssignment(fx.bob, assignmentId, { text: para('v2'), fileIds: [] })
    row = (await db.select().from(submission).where(eq(submission.id, bobSub.id)))[0]
    expect(row.suggestedMark).toBeNull()
    expect(row.suggestedAt).toBeNull()
  })

  it("students never receive the suggestion fields", async () => {
    const fx = await setupCourse(db)
    const { assignmentId, sub } = await withSubmission(fx)
    await suggestSubmissionMark(fx.lecturer, sub.id, { mark: 17, feedback: 'Secret draft feedback' })
    const mine = await getAssignmentForStudent(fx.alice, assignmentId)
    expect(mine.mySubmission).not.toBeNull()
    expect(Object.keys(mine.mySubmission!).filter((k) => k.startsWith('suggest'))).toEqual([])
    expect(JSON.stringify(mine)).not.toContain('Secret draft feedback')
    const list = await listMyAssignments(fx.alice)
    expect(list).toHaveLength(1)
    expect(Object.keys(list[0]).filter((k) => k.startsWith('suggest'))).toEqual([])
    expect(list[0].mark).toBeNull()
  })

  it('suggest_assignment_grade with the submittedAt from get_submission; a newer version → CONFLICT, nothing written', async () => {
    const fx = await setupCourse(db)
    const { assignmentId, sub } = await withSubmission(fx)
    const read = (await callTool('get_submission', fx.lecturer, { submissionId: sub.id })) as { submittedAt: string }
    await callTool('suggest_assignment_grade', fx.lecturer, {
      submissionId: sub.id,
      mark: 11,
      expectedSubmittedAt: read.submittedAt,
    })
    expect((await getSubmissionForLecturer(fx.lecturer, sub.id)).suggestion?.mark).toBe(11)

    // Alice hands in again; the assistant still holds the old version.
    await new Promise((r) => setTimeout(r, 5))
    await submitAssignment(fx.alice, assignmentId, { text: para('Second try.'), fileIds: [] })
    await expect(
      callTool('suggest_assignment_grade', fx.lecturer, { submissionId: sub.id, mark: 12, expectedSubmittedAt: read.submittedAt }),
    ).rejects.toMatchObject({ code: 'CONFLICT', details: { reason: 'resubmitted' }, message: /resubmitted; read the submission again/ })
    const [row] = await db.select().from(submission).where(eq(submission.id, sub.id))
    expect(row).toMatchObject({ suggestedMark: null, mark: null })
    expect(parseToolInput('suggest_assignment_grade', { submissionId: sub.id, mark: 1, expectedSubmittedAt: 'yesterday' }).success).toBe(false)
  })

  it('every assignment draft tool refuses a student (FORBIDDEN)', async () => {
    const fx = await setupCourse(db)
    const { id } = await draft(fx)
    const { sub } = await withSubmission(fx)
    await expect(
      callTool('create_assignment_draft', fx.alice, { courseId: fx.bio.id, title: 'Mine', instructions: 'x', dueAt: inAWeek() }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' })
    await expect(callTool('update_assignment_draft', fx.alice, { assignmentId: id, title: 'Mine' })).rejects.toMatchObject({
      code: 'FORBIDDEN',
    })
    await expect(callTool('suggest_assignment_grade', fx.alice, { submissionId: sub.id, mark: 20 })).rejects.toMatchObject({
      code: 'FORBIDDEN',
    })
    const [row] = await db.select().from(submission).where(eq(submission.id, sub.id))
    expect(row.suggestedMark).toBeNull()
  })
})
