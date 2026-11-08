import { z } from 'zod'
import { MAX_QUESTIONS, SHORT_ANSWER_MAX } from '@/server/tests/rules'
import { MAX_AWAY_MS } from './leave-tracker'

/**
 * What the student's test runner sends with each sync: its device id, the answers the server has
 * not acknowledged yet and the queued leave reports. Read by the sync action before it calls
 * `syncAttempt`, and used by the answer store to read back what it saved in localStorage.
 */

/** One answer as sent: `rev` counts this question's changes on the device (1, 2, 3…). */
export type AnswerInput = { questionId: string; optionId: string | null; text: string | null; rev: number }
/** One leave report: `left` when the page was left, `back` with the absence measured on the device. */
export type ExitReport = { exitId: string; phase: 'left' | 'back'; awayMs: number | null }
export type SyncPayload = { deviceId: string; answers: AnswerInput[]; exits: ExitReport[] }

export const MAX_SYNC_EXITS = 50
export const MAX_REV = 1_000_000
const MAX_ID_LENGTH = 100

const id = z.string().min(1).max(MAX_ID_LENGTH)

export const answerInputSchema = z.object({
  questionId: id,
  optionId: id.nullable(),
  text: z.string().max(SHORT_ANSWER_MAX).nullable(),
  rev: z.int().min(1).max(MAX_REV),
})

export const exitReportSchema = z.object({
  exitId: z.uuid(),
  phase: z.enum(['left', 'back']),
  awayMs: z.int().min(0).max(MAX_AWAY_MS).nullable(),
})

const syncPayloadSchema = z.object({
  deviceId: z.uuid(),
  answers: z
    .array(answerInputSchema)
    .max(MAX_QUESTIONS)
    // One row per question: a question twice in one upsert is ambiguous (and Postgres refuses it).
    .refine((answers) => new Set(answers.map((a) => a.questionId)).size === answers.length),
  exits: z.array(exitReportSchema).max(MAX_SYNC_EXITS),
})

/** The payload when every part is valid, otherwise null. Unknown keys are dropped. */
export function parseSyncPayload(value: unknown): SyncPayload | null {
  const parsed = syncPayloadSchema.safeParse(value)
  return parsed.success ? parsed.data : null
}
