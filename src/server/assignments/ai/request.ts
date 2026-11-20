import { and, eq, inArray, isNull, lte, or, sql } from 'drizzle-orm'
import { isAssignmentMarkingOn, readAiConfig } from '@/server/ai/config'
import { aiCapReached } from '@/server/ai/usage'
import { now } from '@/server/core/clock'
import type { Ctx } from '@/server/core/context'
import { AppError } from '@/server/core/errors'
import { courseRosterQuery } from '@/server/courses/roster'
import type { Db } from '@/server/db'
import { submission } from '@/server/db/schema'
import { requireOwnedAssignment, requireOwnedSubmission } from '../lecturer'
import { NO_SUGGESTION } from '../queries'
import { isStaleQueued, STALE_QUEUED_MS } from '../rules'
import { markingQueue, type MarkingMessage } from './queue'

/** At most this many queue sends run at once. */
const SEND_CHUNK = 20

/** Not queued, or queued so long ago that the job is presumed lost (see isStaleQueued). */
function queueable(at: Date) {
  return or(
    sql`${submission.aiStatus} is distinct from 'queued'`,
    isNull(submission.aiStatusAt),
    lte(submission.aiStatusAt, new Date(at.getTime() - STALE_QUEUED_MS)),
  )
}

/** Refuses when AI marking is off here, or this month's calls have reached the cap. */
async function assertCanSuggest(db: Db): Promise<void> {
  if (!isAssignmentMarkingOn()) {
    throw new AppError('CONFLICT', 'AI mark suggestions are not available', { reason: 'ai_off' })
  }
  if (await aiCapReached(db, now(), readAiConfig().monthlyCap)) {
    throw new AppError('CONFLICT', 'The monthly limit for AI mark suggestions is reached', { reason: 'cap' })
  }
}

/**
 * Sends one message per queued submission, SEND_CHUNK at a time. `requestedAt` is the exact
 * `ai_status_at` written when the rows were claimed, so the job can tell this request from a later
 * one. A message that cannot be sent marks its submission failed (`provider`) instead of leaving
 * it queued; returns how many were sent.
 */
async function sendAll(db: Db, rows: { id: string; submittedAt: Date }[], requestedAt: Date): Promise<number> {
  const queue = markingQueue()
  const unsent: string[] = []
  for (let i = 0; i < rows.length; i += SEND_CHUNK) {
    const chunk = rows.slice(i, i + SEND_CHUNK)
    const results = await Promise.allSettled(
      chunk.map((r) =>
        queue.send({
          submissionId: r.id,
          submittedAt: r.submittedAt.toISOString(),
          requestedAt: requestedAt.toISOString(),
        } satisfies MarkingMessage),
      ),
    )
    chunk.forEach((r, j) => {
      if (results[j].status === 'rejected') unsent.push(r.id)
    })
  }
  if (unsent.length > 0) {
    console.error('[ai-marking] could not queue suggestions', unsent.length)
    await db
      .update(submission)
      .set({ aiStatus: 'failed', aiStatusAt: now(), aiError: 'provider' })
      .where(and(inArray(submission.id, unsent), eq(submission.aiStatus, 'queued'), eq(submission.aiStatusAt, requestedAt)))
  }
  return rows.length - unsent.length
}

/**
 * Queues an AI mark suggestion for every submission of a current roster student that has no mark,
 * no suggestion and is not queued (a failed one is retried, and so is one queued over
 * STALE_QUEUED_MS ago, whose job is presumed lost). Owner only. A draft is
 * CONFLICT { reason: 'not_published' }; AI marking off here is CONFLICT { reason: 'ai_off' }; the
 * monthly cap reached is CONFLICT { reason: 'cap' } and nothing is queued. `queued` is the number of
 * jobs sent.
 */
export async function requestMarkingSuggestions(ctx: Ctx, assignmentId: string): Promise<{ queued: number }> {
  const { row, course } = await requireOwnedAssignment(ctx, assignmentId)
  if (row.status !== 'published') {
    throw new AppError('CONFLICT', 'Publish the assignment first', { reason: 'not_published' })
  }
  await assertCanSuggest(ctx.db)

  const roster = await courseRosterQuery(ctx.db, { courseId: course.id })
  if (roster.length === 0) return { queued: 0 }
  const at = now()
  // One conditional update picks and claims the rows, so two presses never queue a submission twice.
  const claimed = await ctx.db
    .update(submission)
    .set({ aiStatus: 'queued', aiStatusAt: at, aiError: null })
    .where(
      and(
        eq(submission.assignmentId, row.id),
        inArray(
          submission.studentId,
          roster.map((r) => r.studentId),
        ),
        isNull(submission.mark),
        isNull(submission.suggestedAt),
        queueable(at),
      ),
    )
    .returning({ id: submission.id, submittedAt: submission.submittedAt })
  return { queued: await sendAll(ctx.db, claimed, at) }
}

/**
 * Queues a fresh AI mark suggestion for one submission ("Suggest a mark" / "Try again"). Owner
 * only. A graded submission is CONFLICT { reason: 'graded' }; AI marking off or the cap reached
 * as for requestMarkingSuggestions. Queued recently: nothing changes (a stale queued one is queued
 * again). Otherwise any existing
 * suggestion (the assistant's or Clasync's) is cleared, since the lecturer asked for a new one.
 */
export async function requestOneSuggestion(ctx: Ctx, submissionId: string): Promise<void> {
  const { sub } = await requireOwnedSubmission(ctx, submissionId)
  const graded = () => new AppError('CONFLICT', 'This submission already has a grade', { reason: 'graded' })
  if (sub.mark !== null) throw graded()
  await assertCanSuggest(ctx.db)
  const at = now()
  if (sub.aiStatus === 'queued' && !isStaleQueued(sub.aiStatus, sub.aiStatusAt, at)) return

  const claimed = await ctx.db
    .update(submission)
    .set({ ...NO_SUGGESTION, aiStatus: 'queued', aiStatusAt: at })
    .where(and(eq(submission.id, sub.id), isNull(submission.mark), queueable(at)))
    .returning({ id: submission.id, submittedAt: submission.submittedAt })
  if (claimed.length === 0) {
    // Graded meanwhile, or queued by another request (then there is nothing to do).
    const [fresh] = await ctx.db.select({ mark: submission.mark }).from(submission).where(eq(submission.id, sub.id))
    if (fresh && fresh.mark !== null) throw graded()
    return
  }
  await sendAll(ctx.db, claimed, at)
}
