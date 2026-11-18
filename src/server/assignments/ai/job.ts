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

/** Marks the job failed, only while it is still queued (a grade or a new hand-in has cleared it otherwise). */
async function fail(db: Db, submissionId: string, error: AiError): Promise<'failed'> {
  await db
    .update(submission)
    .set({ aiStatus: 'failed', aiStatusAt: now(), aiError: error })
    .where(and(eq(submission.id, submissionId), eq(submission.aiStatus, 'queued')))
  return 'failed'
}

/**
 * One queued AI marking job: asks the suggester for a mark on one submission and stores it as a
 * suggestion from Clasync (never as the mark). Skips, changing nothing, when the submission is gone,
 * graded, handed in again since the request, or no longer queued. Fails (`ai_status='failed'`) with
 * `cap` when this month's calls reached the cap, `unreadable` when there is nothing the model can
 * read, and `provider` when no model is configured or the model call fails; a failed call is logged
 * by category only and is not retried. The suggestion is stored with one conditional update, so a
 * grade or a new hand-in that lands while the model works always wins. Database errors propagate,
 * so the queue retries the message.
 */
export async function runMarkingJob(
  db: Db,
  m: MarkingMessage,
  suggester: AssignmentSuggester | null = getAssignmentSuggester(),
): Promise<MarkingJobResult> {
  const submittedAt = new Date(m.submittedAt)
  const [sub] = await db
    .select({ mark: submission.mark, submittedAt: submission.submittedAt, aiStatus: submission.aiStatus })
    .from(submission)
    .where(eq(submission.id, m.submissionId))
  if (
    !sub ||
    sub.mark !== null ||
    Number.isNaN(submittedAt.getTime()) ||
    sub.submittedAt.getTime() !== submittedAt.getTime() ||
    sub.aiStatus !== 'queued'
  ) {
    return 'skipped'
  }

  if (!suggester) return fail(db, m.submissionId, 'provider')
  const config = readAiConfig()
  if (await aiCapReached(db, now(), config.monthlyCap)) return fail(db, m.submissionId, 'cap')

  const loaded = await loadMarkingInput(db, m.submissionId)
  if (!loaded) return 'skipped'
  const { input, unread, lecturerId } = loaded
  if (input.studentText === null && input.images.length === 0 && input.documents.length === 0) {
    return fail(db, m.submissionId, 'unreadable')
  }

  let suggestion: MarkingSuggestion
  try {
    suggestion = await suggester(input)
  } catch (error) {
    // Category only: a provider's message can quote the student's work.
    const category = error instanceof AssignmentSuggesterError ? error.category : 'other'
    console.error('[ai-marking] suggestion failed', category)
    await recordAiUsage(db, {
      purpose: 'assignment_marking',
      lecturerId,
      submissionId: m.submissionId,
      model: config.assignmentModel,
      inputTokens: 0,
      outputTokens: 0,
      ok: false,
    })
    return fail(db, m.submissionId, 'provider')
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
    .where(
      and(
        eq(submission.id, m.submissionId),
        isNull(submission.mark),
        eq(submission.submittedAt, submittedAt),
        eq(submission.aiStatus, 'queued'),
      ),
    )
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
