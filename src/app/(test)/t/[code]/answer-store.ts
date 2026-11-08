import { clearDraft, loadDraft, saveDraft } from '@/lib/draft-store'
import { SHORT_ANSWER_MAX } from '@/server/tests/rules'
import type { LeaveEvent, OpenExit } from './leave-tracker'
import {
  answerInputSchema,
  exitReportSchema,
  MAX_SYNC_EXITS,
  type AnswerInput,
  type ExitReport,
} from './sync-payload'

export type { OpenExit } from './leave-tracker'

/**
 * A student's attempt as kept on the device, so no answer is lost to a weak connection or a closed
 * tab. Each answer carries `rev` (its change count on this device) and `sentRev` (the highest rev
 * the server acknowledged); it is pending while `rev > sentRev`. The server keeps the highest rev
 * per question, so resending is always harmless. Leave reports wait in `exits` until acknowledged,
 * and `openExit` is the exit not yet returned from (judged on reopening if the tab was closed).
 * Every function returns a new state and never changes the one it is given.
 */
export type LocalAnswer = { optionId: string | null; text: string | null; rev: number; sentRev: number }
export type LocalAttempt = { answers: Record<string, LocalAnswer>; exits: ExitReport[]; openExit: OpenExit | null }

export function attemptKey(userId: string, attemptId: string): string {
  return `clasync:test:${userId}:${attemptId}`
}

export function emptyAttempt(): LocalAttempt {
  return { answers: {}, exits: [], openExit: null }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function toLocalAnswer(questionId: string, value: unknown): LocalAnswer | null {
  if (!isRecord(value)) return null
  const parsed = answerInputSchema.safeParse({ ...value, questionId })
  const { sentRev } = value
  if (!parsed.success || !Number.isInteger(sentRev)) return null
  if ((sentRev as number) < 0 || (sentRev as number) > parsed.data.rev) return null
  return { optionId: parsed.data.optionId, text: parsed.data.text, rev: parsed.data.rev, sentRev: sentRev as number }
}

function toOpenExit(value: unknown): OpenExit | null {
  if (!isRecord(value)) return null
  const { exitId, leftAtEpochMs } = value
  if (!exitReportSchema.shape.exitId.safeParse(exitId).success) return null
  if (typeof leftAtEpochMs !== 'number' || !Number.isFinite(leftAtEpochMs)) return null
  return { exitId: exitId as string, leftAtEpochMs }
}

/**
 * The stored attempt (it may be stale, edited by hand or from an older version): anything that is
 * not an object reads as empty; a damaged answer or report is dropped and the rest kept, and what
 * is kept would pass the sync payload's checks.
 */
export function loadLocalAttempt(key: string): LocalAttempt {
  const stored = loadDraft(key)
  if (!isRecord(stored) || !isRecord(stored.answers)) return emptyAttempt()
  const answers: Record<string, LocalAnswer> = {}
  for (const [questionId, value] of Object.entries(stored.answers)) {
    const answer = toLocalAnswer(questionId, value)
    if (answer) answers[questionId] = answer
  }
  const exits: ExitReport[] = []
  for (const item of Array.isArray(stored.exits) ? stored.exits : []) {
    const parsed = exitReportSchema.safeParse(item)
    if (parsed.success) exits.push(parsed.data)
  }
  return { answers, exits, openExit: toOpenExit(stored.openExit) }
}

/** Never throws: a full or blocked storage just keeps nothing (the server copy still has what was sent). */
export function saveLocalAttempt(key: string, state: LocalAttempt): void {
  saveDraft(key, state)
}

/** After the hand-in, or once the attempt is over for good. */
export function clearLocalAttempt(key: string): void {
  clearDraft(key)
}

/** Cut to the server's limit, without leaving half of a surrogate pair at the end. */
function capText(text: string | null): string | null {
  if (text === null || text.length <= SHORT_ANSWER_MAX) return text
  const cut = text.slice(0, SHORT_ANSWER_MAX)
  const last = cut.charCodeAt(cut.length - 1)
  return last >= 0xd800 && last <= 0xdbff ? cut.slice(0, -1) : cut
}

export function recordAnswer(
  state: LocalAttempt,
  questionId: string,
  value: { optionId: string | null; text: string | null },
): LocalAttempt {
  const previous = state.answers[questionId]
  const answer: LocalAnswer = {
    optionId: value.optionId,
    text: capText(value.text),
    rev: (previous?.rev ?? 0) + 1,
    sentRev: previous?.sentRev ?? 0,
  }
  return { ...state, answers: { ...state.answers, [questionId]: answer } }
}

/** Answers the server has not acknowledged at their current rev. */
export function pendingAnswers(state: LocalAttempt): AnswerInput[] {
  return Object.entries(state.answers)
    .filter(([, a]) => a.rev > a.sentRev)
    .map(([questionId, a]) => ({ questionId, optionId: a.optionId, text: a.text, rev: a.rev }))
}

/** The leave reports to send, oldest first, within the payload's limit. */
export function pendingExits(state: LocalAttempt): ExitReport[] {
  return state.exits.slice(0, MAX_SYNC_EXITS)
}

/** Queues the report for a tracker event and keeps `openExit` in step (stored before the tab can close). */
export function recordLeaveEvent(state: LocalAttempt, event: LeaveEvent): LocalAttempt {
  if (event.type === 'left') {
    return {
      ...state,
      exits: [...state.exits, { exitId: event.exitId, phase: 'left', awayMs: null }],
      openExit: { exitId: event.exitId, leftAtEpochMs: event.leftAtEpochMs },
    }
  }
  return {
    ...state,
    exits: [...state.exits, { exitId: event.exitId, phase: 'back', awayMs: event.awayMs }],
    openExit: state.openExit?.exitId === event.exitId ? null : state.openExit,
  }
}

/** The exit's `left` report is still queued: the server has not counted it. */
export function hasLeftQueued(state: LocalAttempt, exitId: string): boolean {
  return state.exits.some((e) => e.exitId === exitId && e.phase === 'left')
}

/** Forgets an exit the server never heard of (a same-tab reload): its reports and the open exit. */
export function dropExit(state: LocalAttempt, exitId: string): LocalAttempt {
  return {
    ...state,
    exits: state.exits.filter((e) => e.exitId !== exitId),
    openExit: state.openExit?.exitId === exitId ? null : state.openExit,
  }
}

/**
 * After a sync succeeded. `acceptedRevs` is the server's rev per question: an answer changed while
 * the request was in flight has a higher local rev and stays pending. `sentExitIds` has one entry
 * per report sent (an exit's `left` and `back` share an id): each removes the oldest queued report
 * with that id, so a `back` queued while its `left` was in flight is kept.
 */
export function acknowledge(
  state: LocalAttempt,
  acceptedRevs: Record<string, number>,
  sentExitIds: string[],
): LocalAttempt {
  const answers = { ...state.answers }
  for (const [questionId, accepted] of Object.entries(acceptedRevs)) {
    const answer = answers[questionId]
    if (!answer || !Number.isFinite(accepted)) continue
    // A server rev above ours means the server holds a newer answer: ours is no longer pending.
    const sentRev = Math.max(answer.sentRev, Math.min(accepted, answer.rev))
    if (sentRev !== answer.sentRev) answers[questionId] = { ...answer, sentRev }
  }
  const exits = [...state.exits]
  for (const exitId of sentExitIds) {
    const index = exits.findIndex((e) => e.exitId === exitId)
    if (index !== -1) exits.splice(index, 1)
  }
  return { ...state, answers, exits }
}

/**
 * Folds in the server's copy (on opening, or after another device answered): a server answer
 * replaces the local one when its rev is at least the local rev, and is then not pending; a newer
 * local answer is kept and still sent.
 */
export function mergeServerCopy(state: LocalAttempt, saved: AnswerInput[]): LocalAttempt {
  const answers = { ...state.answers }
  for (const s of saved) {
    const local = answers[s.questionId]
    if (local && local.rev > s.rev) continue
    answers[s.questionId] = { optionId: s.optionId, text: s.text, rev: s.rev, sentRev: s.rev }
  }
  return { ...state, answers }
}

/** Questions with an option picked or non-blank text. */
export function answeredCount(state: LocalAttempt): number {
  return Object.values(state.answers).filter((a) => a.optionId !== null || (a.text !== null && a.text.trim() !== ''))
    .length
}
