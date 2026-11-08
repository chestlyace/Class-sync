import { and, eq, inArray, sql } from 'drizzle-orm'
import type { Ctx } from '@/server/core/context'
import { now } from '@/server/core/clock'
import { AppError } from '@/server/core/errors'
import { isOnCourseRoster, requireCourseOwner } from '@/server/courses/service'
import { courseTopic, revisionGroup, revisionOutcome, revisionQuestion } from '@/server/db/schema'
import { loadPracticeQuestions, loadTopicGroups, type PracticeQuestionView } from './authoring'
import { familyHolds } from './hold'
import { MAX_PRACTICE_PER_TOPIC } from './rules'

export const MAX_OUTCOMES_PER_CALL = MAX_PRACTICE_PER_TOPIC

const noAccess = () => new AppError('FORBIDDEN', 'You do not have access to this practice')

/**
 * The practice paper of a topic: every question not held, with right answers, guides and
 * explanations. A rostered student sees it only while the topic is visible; the course owner gets
 * the same shape as a preview, with no outcomes. Missing, hidden, held-only and not-yours all read
 * the same way: FORBIDDEN or simply absent, never a hint.
 */
export async function getPracticePaper(
  ctx: Ctx,
  courseId: string,
  topicId: string,
): Promise<{ topic: { id: string; title: string }; questions: PracticeQuestionView[]; outcomes: Record<string, boolean> }> {
  const isStudent = ctx.user.role === 'student'
  if (isStudent) {
    if (typeof courseId !== 'string' || !(await isOnCourseRoster(ctx.db, courseId, ctx.user.id))) throw noAccess()
  } else {
    await requireCourseOwner(ctx, courseId)
  }
  const [topic] =
    typeof topicId === 'string' && topicId.length > 0
      ? await ctx.db
          .select()
          .from(courseTopic)
          .where(and(eq(courseTopic.id, topicId), eq(courseTopic.courseId, courseId)))
      : []
  if (!topic || (isStudent && topic.hidden)) throw noAccess()

  const groups = await loadTopicGroups(ctx.db, topic.id)
  const families = [...new Set(groups.map((g) => g.sourceFamilyId).filter((f): f is string => f !== null))]
  const holds = await familyHolds(ctx.db, families, now())
  const open = groups.filter((g) => g.sourceFamilyId === null || !holds.has(g.sourceFamilyId))
  const byGroup = await loadPracticeQuestions(
    ctx.db,
    open.map((g) => g.id),
  )
  const questions = open.flatMap((g) => byGroup.get(g.id) ?? [])

  const outcomes: Record<string, boolean> = {}
  if (isStudent && questions.length > 0) {
    const rows = await ctx.db
      .select({ questionId: revisionOutcome.questionId, correct: revisionOutcome.correct })
      .from(revisionOutcome)
      .where(
        and(
          eq(revisionOutcome.studentId, ctx.user.id),
          inArray(
            revisionOutcome.questionId,
            questions.map((q) => q.id),
          ),
        ),
      )
    for (const r of rows) outcomes[r.questionId] = r.correct
  }
  return { topic: { id: topic.id, title: topic.title }, questions, outcomes }
}

/**
 * Saves a student's latest right/wrong per question. Private to the student. Questions that are
 * not visible to them now (hidden topic, held group, another course, unknown) are skipped without
 * failing the rest. When a question appears more than once the last entry wins.
 */
export async function recordPracticeOutcomes(
  ctx: Ctx,
  courseId: string,
  outcomes: { questionId: string; correct: boolean }[],
): Promise<{ saved: number }> {
  if (ctx.user.role !== 'student') throw noAccess()
  if (typeof courseId !== 'string' || !(await isOnCourseRoster(ctx.db, courseId, ctx.user.id))) throw noAccess()
  if (!Array.isArray(outcomes) || outcomes.length > MAX_OUTCOMES_PER_CALL) {
    throw new AppError('VALIDATION', 'Invalid outcomes', { fields: ['outcomes'] })
  }
  const latest = new Map<string, boolean>()
  for (const o of outcomes) {
    if (typeof o !== 'object' || o === null || typeof o.questionId !== 'string' || typeof o.correct !== 'boolean') {
      throw new AppError('VALIDATION', 'Invalid outcomes', { fields: ['outcomes'] })
    }
    latest.set(o.questionId, o.correct)
  }
  if (latest.size === 0) return { saved: 0 }

  const rows = await ctx.db
    .select({ id: revisionQuestion.id, family: revisionGroup.sourceFamilyId })
    .from(revisionQuestion)
    .innerJoin(revisionGroup, eq(revisionGroup.id, revisionQuestion.groupId))
    .innerJoin(courseTopic, eq(courseTopic.id, revisionGroup.topicId))
    .where(
      and(
        inArray(revisionQuestion.id, [...latest.keys()]),
        eq(revisionGroup.courseId, courseId),
        eq(courseTopic.hidden, false),
      ),
    )
  const at = now()
  const holds = await familyHolds(
    ctx.db,
    [...new Set(rows.map((r) => r.family).filter((f): f is string => f !== null))],
    at,
  )
  const visible = rows.filter((r) => r.family === null || !holds.has(r.family))
  if (visible.length === 0) return { saved: 0 }

  await ctx.db
    .insert(revisionOutcome)
    .values(visible.map((r) => ({ studentId: ctx.user.id, questionId: r.id, correct: latest.get(r.id)!, answeredAt: at })))
    .onConflictDoUpdate({
      target: [revisionOutcome.studentId, revisionOutcome.questionId],
      set: { correct: sql`excluded.correct`, answeredAt: sql`excluded.answered_at` },
    })
  return { saved: visible.length }
}
