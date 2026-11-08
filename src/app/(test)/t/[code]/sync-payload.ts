import { z } from 'zod'
// Types only (erased at build): one definition shared with the service, no server code in the bundle.
import type { AnswerInput, ExitReport, SyncInput } from '@/server/tests/attempt'
import { MAX_QUESTIONS, SHORT_ANSWER_MAX } from '@/server/tests/rules'
import { MAX_AWAY_MS } from './leave-tracker'

export type { AnswerInput, ExitReport }

/**
 * What the student's test runner sends with each sync: its device id, the answers the server has
 * not acknowledged yet, the queued leave reports, and `withPaper` when it holds no paper yet. Read
 * by the sync and hand-in routes before they call the service, and used by the answer store to
 * read back what it saved in localStorage.
 */

export type SyncPayload = SyncInput

export const MAX_SYNC_EXITS = 50
export const MAX_REV = 1_000_000
const MAX_ID_LENGTH = 100

const id = z.string().min(1).max(MAX_ID_LENGTH)

export const answerInputSchema = z.object({
  questionId: id,
  optionId: id.nullable(),
  text: z.string().max(SHORT_ANSWER_MAX).nullable(),
  rev: z.int().min(1).max(MAX_REV),
}) satisfies z.ZodType<AnswerInput>

export const exitReportSchema = z.object({
  exitId: z.uuid(),
  phase: z.enum(['left', 'back']),
  awayMs: z.int().min(0).max(MAX_AWAY_MS).nullable(),
}) satisfies z.ZodType<ExitReport>

const syncPayloadSchema = z.object({
  deviceId: z.uuid(),
  answers: z
    .array(answerInputSchema)
    .max(MAX_QUESTIONS)
    // One row per question: a question twice in one upsert is ambiguous (and Postgres refuses it).
    .refine((answers) => new Set(answers.map((a) => a.questionId)).size === answers.length),
  exits: z.array(exitReportSchema).max(MAX_SYNC_EXITS),
  withPaper: z.boolean().optional(),
}) satisfies z.ZodType<SyncPayload>

/** The payload when every part is valid, otherwise null. Unknown keys are dropped. */
export function parseSyncPayload(value: unknown): SyncPayload | null {
  const parsed = syncPayloadSchema.safeParse(value)
  return parsed.success ? parsed.data : null
}
