import { asc, count, eq, inArray, max } from 'drizzle-orm'
import type { Ctx } from '@/server/core/context'
import { AppError } from '@/server/core/errors'
import { requireCourseOwner } from '@/server/courses/service'
import type { Db } from '@/server/db'
import { courseTopic, resourcePlacement, revisionGroup, revisionQuestion } from '@/server/db/schema'
import { parseTitle, swapPositions } from './rules'

type Executor = Pick<Db, 'select' | 'insert' | 'update' | 'delete'>

function badTitle(): never {
  throw new AppError('VALIDATION', 'The title must be 1 to 200 characters', { fields: ['title'] })
}

/**
 * The topic, once the caller owns its course. A missing topic and someone else's are both FORBIDDEN.
 */
export async function requireOwnedTopic(ctx: Ctx, topicId: string): Promise<{ id: string; courseId: string }> {
  const [row] = await ctx.db
    .select({ id: courseTopic.id, courseId: courseTopic.courseId })
    .from(courseTopic)
    .where(eq(courseTopic.id, topicId))
  if (!row) throw new AppError('FORBIDDEN', 'Only the lecturer of this course can do this')
  await requireCourseOwner(ctx, row.courseId)
  return row
}

/** FORBIDDEN unless `topicId` is a topic of `courseId` (the caller owns the course already). */
export async function assertTopicInCourse(db: Executor, topicId: string, courseId: string): Promise<void> {
  const [row] = await db.select({ courseId: courseTopic.courseId }).from(courseTopic).where(eq(courseTopic.id, topicId))
  if (!row || row.courseId !== courseId) throw new AppError('FORBIDDEN', 'That topic is not in this course')
}

export async function createTopic(ctx: Ctx, courseId: string, input: { title: string }): Promise<{ id: string }> {
  await requireCourseOwner(ctx, courseId)
  const title = parseTitle(input.title)
  if (!title) badTitle()
  const [last] = await ctx.db
    .select({ position: max(courseTopic.position) })
    .from(courseTopic)
    .where(eq(courseTopic.courseId, courseId))
  const [row] = await ctx.db
    .insert(courseTopic)
    .values({ courseId, title, position: (last?.position ?? 0) + 1 })
    .returning({ id: courseTopic.id })
  return { id: row.id }
}

export async function renameTopic(ctx: Ctx, topicId: string, input: { title: string }): Promise<void> {
  await requireOwnedTopic(ctx, topicId)
  const title = parseTitle(input.title)
  if (!title) badTitle()
  await ctx.db.update(courseTopic).set({ title, updatedAt: new Date() }).where(eq(courseTopic.id, topicId))
}

export async function setTopicHidden(ctx: Ctx, topicId: string, hidden: boolean): Promise<void> {
  await requireOwnedTopic(ctx, topicId)
  await ctx.db.update(courseTopic).set({ hidden, updatedAt: new Date() }).where(eq(courseTopic.id, topicId))
}

/** One place up or down among the course's topics; at either end it does nothing. */
export async function moveTopic(ctx: Ctx, topicId: string, dir: 'up' | 'down'): Promise<void> {
  const topic = await requireOwnedTopic(ctx, topicId)
  await ctx.db.transaction(async (tx) => {
    const list = await tx
      .select({ id: courseTopic.id })
      .from(courseTopic)
      .where(eq(courseTopic.courseId, topic.courseId))
      .orderBy(asc(courseTopic.position), asc(courseTopic.createdAt), asc(courseTopic.id))
    const next = swapPositions(list, topicId, dir)
    if (!next) return
    for (const [i, t] of next.entries()) {
      await tx
        .update(courseTopic)
        .set({ position: i + 1 })
        .where(eq(courseTopic.id, t.id))
    }
  })
}

/** Only an empty topic goes: no items and no practice questions, else CONFLICT { reason: 'not_empty' }. */
export async function deleteTopic(ctx: Ctx, topicId: string): Promise<void> {
  await requireOwnedTopic(ctx, topicId)
  await ctx.db.transaction(async (tx) => {
    const [items] = await tx
      .select({ n: count() })
      .from(resourcePlacement)
      .where(eq(resourcePlacement.topicId, topicId))
    const groups = await tx.select({ id: revisionGroup.id }).from(revisionGroup).where(eq(revisionGroup.topicId, topicId))
    let questions = 0
    if (groups.length > 0) {
      const [q] = await tx
        .select({ n: count() })
        .from(revisionQuestion)
        .where(
          inArray(
            revisionQuestion.groupId,
            groups.map((g) => g.id),
          ),
        )
      questions = q.n
    }
    if (items.n > 0 || questions > 0) {
      throw new AppError('CONFLICT', 'This topic still has material', { reason: 'not_empty' })
    }
    // Groups with no questions left only block the foreign key.
    await tx.delete(revisionGroup).where(eq(revisionGroup.topicId, topicId))
    await tx.delete(courseTopic).where(eq(courseTopic.id, topicId))
  })
}
