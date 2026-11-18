import { and, eq, isNull } from 'drizzle-orm'
import { readAiConfig } from '@/server/ai/config'
import { aiCapReached, recordAiUsage } from '@/server/ai/usage'
import { now } from '@/server/core/clock'
import type { Db } from '@/server/db'
import { submission, type AiError } from '@/server/db/schema'
import { loadMarkingInput } from './inputs'
import type { MarkingMessage } from './queue'
import {
  AssignmentSuggesterError,
  getAssignmentSuggester,
  type AssignmentSuggester,
  type MarkingSuggestion,
} from './suggester'

export type MarkingJobResult = 'stored' | 'skipped' | 'failed'

/** The whole job (loading the hand-in and the model call) must finish within this, under the consumer's 60 s. */
const JOB_BUDGET_MS = 50_000
/** Below this much time left after loading, the model is not called at all. */
const MIN_CALL_MS = 5_000
/** A message delivered more often than this was cut off before finishing (the platform killed it): no more calls. */
const MAX_DELIVERIES = 2

export type MarkingJobOptions = {
  /** The queue's delivery count for this message (1 on the first delivery). */
  deliveryCount?: number
  /** Reads a stored file; by default from the configured storage. */
  read?: (key: string) => Promise<Uint8Array>
}

/** Same row, same hand-in, same request, still queued: the only state a job may write to. */
function stillThisJob(submissionId: string, requestedAt: Date) {
  return and(eq(submission.id, submissionId), eq(submission.aiStatus, 'queued'), eq(submission.aiStatusAt, requestedAt))
}

/** Marks the job failed, only while this request is still the queued one. */
async function fail(db: Db, submissionId: string, requestedAt: Date, error: AiError): Promise<'failed'> {
  await db
    .update(submission)
    .set({ aiStatus: 'failed', aiStatusAt: now(), aiError: error })
    .where(stillThisJob(submissionId, requestedAt))
  return 'failed'
}

const validDate = (iso: string): Date | null => {
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? null : d
}

/**
 * One queued AI marking job: asks the suggester for a mark on one submission and stores it as a
 * suggestion from Clasync (never as the mark). Skips, changing nothing, when the submission is gone,
 * graded, handed in again since the request, no longer queued, or queued again by a later request
 * (`ai_status_at` differs from `requestedAt`). Fails (`ai_status='failed'`) with `cap` when this
 * month's calls reached the cap, `unreadable` when there is nothing the model can read, and
 * `provider` when no model is configured, the message was already delivered twice (an earlier run
 * was cut off), too little of the 50 s budget is left after loading, or the model call fails; a
 * failed call is logged by category only and is not retried. Every write is conditional on the
 * row still being this job's, so a grade, a new hand-in or a new request always wins. Database
 * errors propagate, so the queue retries the message.
 */
export async function runMarkingJob(
  db: Db,
  m: MarkingMessage,
  suggester: AssignmentSuggester | null = getAssignmentSuggester(),
  opts: MarkingJobOptions = {},
): Promise<MarkingJobResult> {
  const deadline = now().getTime() + JOB_BUDGET_MS
  const submittedAt = validDate(m.submittedAt)
  const requestedAt = validDate(m.requestedAt)
  if (!submittedAt || !requestedAt) return 'skipped'
  const [sub] = await db
    .select({
      mark: submission.mark,
      submittedAt: submission.submittedAt,
      aiStatus: submission.aiStatus,
      aiStatusAt: submission.aiStatusAt,
    })
    .from(submission)
    .where(eq(submission.id, m.submissionId))
  if (
    !sub ||
    sub.mark !== null ||
    sub.submittedAt.getTime() !== submittedAt.getTime() ||
    sub.aiStatus !== 'queued' ||
    sub.aiStatusAt?.getTime() !== requestedAt.getTime()
  ) {
    return 'skipped'
  }

  if ((opts.deliveryCount ?? 1) > MAX_DELIVERIES) {
    console.error('[ai-marking] suggestion failed', 'redelivered')
    return fail(db, m.submissionId, requestedAt, 'provider')
  }
  if (!suggester) return fail(db, m.submissionId, requestedAt, 'provider')
  const config = readAiConfig()
  if (await aiCapReached(db, now(), config.monthlyCap)) return fail(db, m.submissionId, requestedAt, 'cap')

  const loaded = await loadMarkingInput(db, m.submissionId, opts.read)
  if (!loaded) return 'skipped'
  const { input, unread, lecturerId } = loaded
  if (input.studentText === null && input.images.length === 0 && input.documents.length === 0) {
    return fail(db, m.submissionId, requestedAt, 'unreadable')
  }
  const remaining = deadline - now().getTime()
  if (remaining < MIN_CALL_MS) {
    console.error('[ai-marking] suggestion failed', 'no_time_left')
    return fail(db, m.submissionId, requestedAt, 'provider')
  }

  let suggestion: MarkingSuggestion
  try {
    suggestion = await suggester(input, { signal: AbortSignal.timeout(remaining) })
  } catch (error) {
    // Category only: a provider's message can quote the student's work.
    const category = error instanceof AssignmentSuggesterError ? error.category : 'other'
    console.error('[ai-marking] suggestion failed', category)
    // Status first: if recording the call then throws, the retry finds the row failed and calls nothing.
    await fail(db, m.submissionId, requestedAt, 'provider')
    await recordAiUsage(db, {
      purpose: 'assignment_marking',
      lecturerId,
      submissionId: m.submissionId,
      model: config.assignmentModel,
      inputTokens: 0,
      outputTokens: 0,
      ok: false,
    })
    return 'failed'
  }

  const stored = await db
    .update(submission)
    .set({
      suggestedMark: suggestion.mark,
      suggestedFeedback: suggestion.feedback,
      suggestedAt: now(),
      suggestedBy: 'clasync',
      suggestedTranscript: suggestion.transcript,
      suggestedUnread: unread.length > 0 ? unread : null,
      aiStatus: null,
      aiStatusAt: null,
      aiError: null,
    })
    .where(and(stillThisJob(m.submissionId, requestedAt), isNull(submission.mark), eq(submission.submittedAt, submittedAt)))
    .returning({ id: submission.id })
  // The call is billed whether or not its answer is still wanted, so it always counts toward the cap.
  await recordAiUsage(db, {
    purpose: 'assignment_marking',
    lecturerId,
    submissionId: m.submissionId,
    model: suggestion.model,
    inputTokens: suggestion.inputTokens,
    outputTokens: suggestion.outputTokens,
    ok: true,
  })
  return stored.length > 0 ? 'stored' : 'skipped'
}
