import { and, asc, eq, inArray, isNotNull, isNull, max, notInArray, sql } from 'drizzle-orm'
import type { Ctx } from '@/server/core/context'
import { now } from '@/server/core/clock'
import { AppError } from '@/server/core/errors'
import { requireRole } from '@/server/core/guards'
import { requireCourseOwner, type CourseSummary } from '@/server/courses/service'
import type { Db } from '@/server/db'
import { courseTest, courseTopic, revisionGroup, revisionOption, revisionQuestion } from '@/server/db/schema'
import { loadStoredQuestions, loadTestRow } from '@/server/tests/queries'
import { testPhase } from '@/server/tests/phase'
import { familyHolds, type HoldInfo } from './hold'
import { MAX_PRACTICE_PER_TOPIC, parsePracticeInput, type PracticeInput } from './rules'

type Tx = Parameters<Parameters<Db['transaction']>[0]>[0]
type Conn = Db | Tx

export type PracticeQuestionView = {
  id: string
  kind: 'mcq' | 'short'
  prompt: string
  guide: string | null
  explanation: string | null
  options: { id: string; text: string; isCorrect: boolean }[]
}

export type PracticeGroupView = {
  id: string
  source: { testId: string | null; title: string } | null
  held: HoldInfo | null
  questions: PracticeQuestionView[]
}

function forbidden(): never {
  throw new AppError('FORBIDDEN', 'Only the lecturer of this course can do this')
}

function tooMany(): never {
  throw new AppError('CONFLICT', 'This topic has reached its practice question limit', { reason: 'too_many' })
}

function parseOrThrow(input: unknown): PracticeInput {
  const parsed = parsePracticeInput(input)
  if (!parsed.ok) throw new AppError('VALIDATION', 'Invalid practice question', { fields: parsed.fields })
  return parsed.value
}

/** Owner-only topic lookup; missing and not-yours are both FORBIDDEN. */
async function requireOwnedTopic(ctx: Ctx, topicId: string) {
  requireRole(ctx, 'lecturer')
  const [topic] =
    typeof topicId === 'string' && topicId.length > 0
      ? await ctx.db.select().from(courseTopic).where(eq(courseTopic.id, topicId))
      : []
  if (!topic) forbidden()
  return { topic, course: await requireCourseOwner(ctx, topic.courseId) }
}

/** Owner-only question lookup (question -> group -> course). */
async function requireOwnedQuestion(ctx: Ctx, questionId: string) {
  requireRole(ctx, 'lecturer')
  const [row] =
    typeof questionId === 'string' && questionId.length > 0
      ? await ctx.db
          .select({ question: revisionQuestion, group: revisionGroup })
          .from(revisionQuestion)
          .innerJoin(revisionGroup, eq(revisionGroup.id, revisionQuestion.groupId))
          .where(eq(revisionQuestion.id, questionId))
      : []
  if (!row) forbidden()
  await requireCourseOwner(ctx, row.group.courseId)
  return row
}

async function countInTopic(db: Conn, topicId: string): Promise<number> {
  const [row] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(revisionQuestion)
    .innerJoin(revisionGroup, eq(revisionGroup.id, revisionQuestion.groupId))
    .where(eq(revisionGroup.topicId, topicId))
  return row?.n ?? 0
}

/** The groups' questions with options, in position order. Owner data: includes the right answers and guides. */
export async function loadPracticeQuestions(db: Conn, groupIds: string[]): Promise<Map<string, PracticeQuestionView[]>> {
  const byGroup = new Map<string, PracticeQuestionView[]>(groupIds.map((id) => [id, []]))
  if (groupIds.length === 0) return byGroup
  const questions = await db
    .select()
    .from(revisionQuestion)
    .where(inArray(revisionQuestion.groupId, groupIds))
    .orderBy(asc(revisionQuestion.position), asc(revisionQuestion.id))
  if (questions.length === 0) return byGroup
  const options = await db
    .select()
    .from(revisionOption)
    .where(
      inArray(
        revisionOption.questionId,
        questions.map((q) => q.id),
      ),
    )
    .orderBy(asc(revisionOption.position), asc(revisionOption.id))
  const optionsOf = new Map<string, PracticeQuestionView['options']>()
  for (const o of options) {
    const list = optionsOf.get(o.questionId) ?? []
    list.push({ id: o.id, text: o.text, isCorrect: o.isCorrect })
    optionsOf.set(o.questionId, list)
  }
  for (const q of questions) {
    byGroup.get(q.groupId)?.push({
      id: q.id,
      kind: q.kind,
      prompt: q.prompt,
      guide: q.guide,
      explanation: q.explanation,
      options: optionsOf.get(q.id) ?? [],
    })
  }
  return byGroup
}

/** Practice groups of a topic: written-here first, then imported ones in the order they were brought in. */
export async function loadTopicGroups(db: Conn, topicId: string) {
  return db
    .select()
    .from(revisionGroup)
    .where(eq(revisionGroup.topicId, topicId))
    .orderBy(sql`(${revisionGroup.sourceFamilyId} is not null)`, asc(revisionGroup.position), asc(revisionGroup.id))
}

export async function getPracticeForLecturer(
  ctx: Ctx,
  topicId: string,
): Promise<{
  course: CourseSummary
  topic: { id: string; title: string; hidden: boolean }
  groups: PracticeGroupView[]
  importable: { id: string; title: string; endedAt: Date }[]
}> {
  const { topic, course } = await requireOwnedTopic(ctx, topicId)
  const at = now()
  const groups = await loadTopicGroups(ctx.db, topic.id)
  const families = [...new Set(groups.map((g) => g.sourceFamilyId).filter((f): f is string => f !== null))]
  const [holds, questions] = await Promise.all([
    familyHolds(ctx.db, families, at),
    loadPracticeQuestions(
      ctx.db,
      groups.map((g) => g.id),
    ),
  ])

  const imported = await ctx.db
    .select({ testId: revisionGroup.sourceTestId })
    .from(revisionGroup)
    .where(and(eq(revisionGroup.courseId, course.id), isNotNull(revisionGroup.sourceTestId)))
  const importedIds = imported.map((r) => r.testId).filter((id): id is string => id !== null)
  const tests = await ctx.db
    .select()
    .from(courseTest)
    .where(
      importedIds.length > 0
        ? and(eq(courseTest.courseId, course.id), notInArray(courseTest.id, importedIds))
        : eq(courseTest.courseId, course.id),
    )
    .orderBy(asc(courseTest.createdAt), asc(courseTest.id))
  const importable = tests
    .filter((t) => testPhase(t, at) === 'ended')
    .map((t) => ({ id: t.id, title: t.title, endedAt: endOf(t) }))

  return {
    course,
    topic: { id: topic.id, title: topic.title, hidden: topic.hidden },
    groups: groups.map((g) => ({
      id: g.id,
      source: g.sourceFamilyId === null ? null : { testId: g.sourceTestId, title: g.sourceTitle ?? '' },
      held: g.sourceFamilyId === null ? null : (holds.get(g.sourceFamilyId) ?? null),
      questions: questions.get(g.id) ?? [],
    })),
    importable,
  }
}

function endOf(t: { deadlineAt: Date | null; endedAt: Date | null }): Date {
  const times = [t.deadlineAt, t.endedAt].filter((d): d is Date => d !== null)
  return new Date(Math.min(...times.map((d) => d.getTime())))
}

async function insertQuestion(db: Conn, groupId: string, position: number, input: PracticeInput): Promise<string> {
  const [q] = await db
    .insert(revisionQuestion)
    .values({
      groupId,
      position,
      kind: input.kind,
      prompt: input.prompt,
      guide: input.kind === 'short' ? input.guide : null,
      explanation: input.explanation,
    })
    .returning({ id: revisionQuestion.id })
  if (input.kind === 'mcq') {
    await db
      .insert(revisionOption)
      .values(input.options.map((o, i) => ({ questionId: q.id, position: i, text: o.text, isCorrect: o.isCorrect })))
  }
  return q.id
}

async function nextQuestionPosition(db: Conn, groupId: string): Promise<number> {
  const [row] = await db
    .select({ top: max(revisionQuestion.position) })
    .from(revisionQuestion)
    .where(eq(revisionQuestion.groupId, groupId))
  return (row?.top ?? -1) + 1
}

/** Adds a question to the topic's "written here" group, which is created with the first one. */
export async function addPracticeQuestion(ctx: Ctx, topicId: string, input: unknown): Promise<{ id: string }> {
  const { topic, course } = await requireOwnedTopic(ctx, topicId)
  const value = parseOrThrow(input)
  return ctx.db.transaction(async (tx) => {
    if ((await countInTopic(tx, topic.id)) >= MAX_PRACTICE_PER_TOPIC) tooMany()
    const [top] = await tx
      .select({ top: max(revisionGroup.position) })
      .from(revisionGroup)
      .where(eq(revisionGroup.topicId, topic.id))
    await tx
      .insert(revisionGroup)
      .values({ courseId: course.id, topicId: topic.id, position: (top?.top ?? -1) + 1 })
      .onConflictDoNothing()
    const [group] = await tx
      .select({ id: revisionGroup.id })
      .from(revisionGroup)
      .where(and(eq(revisionGroup.topicId, topic.id), isNull(revisionGroup.sourceFamilyId)))
    const id = await insertQuestion(tx, group.id, await nextQuestionPosition(tx, group.id), value)
    return { id }
  })
}

export async function updatePracticeQuestion(ctx: Ctx, questionId: string, input: unknown): Promise<void> {
  const { question } = await requireOwnedQuestion(ctx, questionId)
  const value = parseOrThrow(input)
  await ctx.db.transaction(async (tx) => {
    await tx
      .update(revisionQuestion)
      .set({
        kind: value.kind,
        prompt: value.prompt,
        guide: value.kind === 'short' ? value.guide : null,
        explanation: value.explanation,
      })
      .where(eq(revisionQuestion.id, question.id))
    await tx.delete(revisionOption).where(eq(revisionOption.questionId, question.id))
    if (value.kind === 'mcq') {
      await tx
        .insert(revisionOption)
        .values(value.options.map((o, i) => ({ questionId: question.id, position: i, text: o.text, isCorrect: o.isCorrect })))
    }
  })
}

export async function deletePracticeQuestion(ctx: Ctx, questionId: string): Promise<void> {
  const { question } = await requireOwnedQuestion(ctx, questionId)
  await ctx.db.delete(revisionQuestion).where(eq(revisionQuestion.id, question.id))
}

/** Swaps the question with its neighbour inside its group; at the end of the list nothing happens. */
export async function movePracticeQuestion(ctx: Ctx, questionId: string, dir: 'up' | 'down'): Promise<void> {
  const { question } = await requireOwnedQuestion(ctx, questionId)
  if (dir !== 'up' && dir !== 'down') throw new AppError('VALIDATION', 'Invalid direction', { fields: ['dir'] })
  await ctx.db.transaction(async (tx) => {
    const siblings = await tx
      .select({ id: revisionQuestion.id })
      .from(revisionQuestion)
      .where(eq(revisionQuestion.groupId, question.groupId))
      .orderBy(asc(revisionQuestion.position), asc(revisionQuestion.id))
    const ids = siblings.map((s) => s.id)
    const from = ids.indexOf(question.id)
    const to = dir === 'up' ? from - 1 : from + 1
    if (from < 0 || to < 0 || to >= ids.length) return
    ;[ids[from], ids[to]] = [ids[to], ids[from]]
    for (const [position, id] of ids.entries()) {
      await tx.update(revisionQuestion).set({ position }).where(eq(revisionQuestion.id, id))
    }
  })
}

/**
 * Copies an ended test of this course into the topic as a new group: prompts, options with the
 * right one, and guides; marks are dropped and explanations start empty. The group is held while
 * any copy of the test elsewhere has not been released.
 */
export async function importTestQuestions(
  ctx: Ctx,
  topicId: string,
  testId: string,
): Promise<{ groupId: string; count: number }> {
  const { topic, course } = await requireOwnedTopic(ctx, topicId)
  const test = await loadTestRow(ctx.db, testId)
  if (!test || test.courseId !== course.id) forbidden()
  if (testPhase(test, now()) !== 'ended') {
    throw new AppError('CONFLICT', 'The test has not ended', { reason: 'not_ended' })
  }
  const already = () => new AppError('CONFLICT', 'This test is already in revision', { reason: 'already_imported' })
  const [existing] = await ctx.db
    .select({ id: revisionGroup.id })
    .from(revisionGroup)
    .where(and(eq(revisionGroup.courseId, course.id), eq(revisionGroup.sourceTestId, test.id)))
  if (existing) throw already()

  const stored = await loadStoredQuestions(ctx.db, test.id)
  try {
    return await ctx.db.transaction(async (tx) => {
      if ((await countInTopic(tx, topic.id)) + stored.length > MAX_PRACTICE_PER_TOPIC) tooMany()
      const [top] = await tx
        .select({ top: max(revisionGroup.position) })
        .from(revisionGroup)
        .where(eq(revisionGroup.topicId, topic.id))
      const [group] = await tx
        .insert(revisionGroup)
        .values({
          courseId: course.id,
          topicId: topic.id,
          sourceTestId: test.id,
          sourceFamilyId: test.familyId,
          sourceTitle: test.title,
          position: (top?.top ?? -1) + 1,
        })
        .returning({ id: revisionGroup.id })
      for (const [i, q] of stored.entries()) {
        const input: PracticeInput =
          q.kind === 'mcq'
            ? {
                kind: 'mcq',
                prompt: q.prompt,
                options: q.options.map((o) => ({ text: o.text, isCorrect: o.isCorrect })),
                explanation: null,
              }
            : { kind: 'short', prompt: q.prompt, guide: q.guide ?? '', explanation: null }
        await insertQuestion(tx, group.id, i, input)
      }
      return { groupId: group.id, count: stored.length }
    })
  } catch (e) {
    // A concurrent import of the same test hits the unique index.
    if (e instanceof AppError) throw e
    const [again] = await ctx.db
      .select({ id: revisionGroup.id })
      .from(revisionGroup)
      .where(and(eq(revisionGroup.courseId, course.id), eq(revisionGroup.sourceTestId, test.id)))
    if (again) throw already()
    throw e
  }
}

export async function deletePracticeGroup(ctx: Ctx, groupId: string): Promise<void> {
  requireRole(ctx, 'lecturer')
  const [group] =
    typeof groupId === 'string' && groupId.length > 0
      ? await ctx.db.select().from(revisionGroup).where(eq(revisionGroup.id, groupId))
      : []
  if (!group) forbidden()
  await requireCourseOwner(ctx, group.courseId)
  await ctx.db.delete(revisionGroup).where(eq(revisionGroup.id, group.id))
}
