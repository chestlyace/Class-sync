// Pure decisions of the student's test runner (no React, no browser): tested on their own.
import type { AttemptStage, QuickResult } from '@/server/tests/attempt'
import { judgeExit, type LeavingRule } from '@/server/tests/leaving'
import { STUDENT_SYNC_MS } from '@/server/tests/rules'
import type { LocalAttempt } from './answer-store'
import { MAX_AWAY_MS, type OpenExit } from './leave-tracker'
import type { SyncStatus } from './screen-parts'
import type { AnswerInput, ExitReport } from './sync-payload'

export type Verdict = ReturnType<typeof judgeExit>

// ---------------------------------------------------------------------------------------------
// Server clock
// ---------------------------------------------------------------------------------------------

/** One clock reading from a sync: the offset (server minus device) and the request's round trip. */
export type ClockSample = { offsetMs: number; rttMs: number }

/**
 * Keeps the most precise reading: an offset is only known to ± half its round trip, so a sample
 * with a lower round trip replaces the current one and a slower one is ignored. Except when the two
 * ranges cannot both be right (the device clock was changed): then the newer reading wins.
 */
export function pickClockSample(current: ClockSample | null, next: ClockSample): ClockSample {
  if (current === null || next.rttMs <= current.rttMs) return next
  const tolerance = (current.rttMs + next.rttMs) / 2 + 1000
  return Math.abs(next.offsetMs - current.offsetMs) > tolerance ? next : current
}

// ---------------------------------------------------------------------------------------------
// Sync timing
// ---------------------------------------------------------------------------------------------

const RETRY_BASE_MS = 2000
const RETRY_MAX_MS = 30_000

/** Delay before the next sync: the normal interval, or a backoff (2 s, 4 s … 30 s) after failures. */
export function retryDelayMs(failures: number): number {
  if (failures <= 0) return STUDENT_SYNC_MS
  return Math.min(RETRY_MAX_MS, RETRY_BASE_MS * 2 ** (failures - 1))
}

/**
 * When the next sync is due (epoch ms). A new timer replaces the current one (typing pushes the
 * send back), except with `keepSooner`: then a timer already due sooner (an answer changed while
 * a sync was in flight) is kept.
 */
export function syncDueAt(currentDueAt: number | null, nowMs: number, delayMs: number, keepSooner: boolean): number {
  const due = nowMs + delayMs
  return keepSooner && currentDueAt !== null && currentDueAt < due ? currentDueAt : due
}

/**
 * Whether the runner keeps talking to the server: while waiting, answering or ended for leaving
 * (the lecturer may let the student back in); after that only while answers are still queued
 * (the grace) or an MCQ-only total is still to come. A result only shows once the answers are
 * final, so then nothing queued can still go in.
 */
export function keepSyncing(
  view: { stage: AttemptStage; attemptId: string | null; hasShort: boolean; result: QuickResult | null; awaitingRelease: boolean },
  hasPending: boolean,
): boolean {
  if (view.attemptId === null) return false
  if (view.stage === 'waiting' || view.stage === 'answering' || view.stage === 'ended_left') return true
  if (view.result !== null) return false
  if (hasPending) return true
  return resultState(view) === 'pending'
}

/**
 * Answers that stay queued although they can never go in, marked as sent so the runner stops
 * resending them and shows "Saved". The server drops answers silently once the attempt no longer
 * takes them (it acknowledges either every answer of a request or none). So after a successful
 * request answered with `handed_in` or `over`, an answer sent and not acknowledged at that rev is
 * final; one changed since it was sent goes out once more. Once a result shows, every answer is
 * final. Never while waiting, answering or ended for leaving (the lecturer may let the student
 * back in): those answers are kept and sent.
 */
export function settleFinalAnswers(
  state: LocalAttempt,
  view: { stage: AttemptStage; result: QuickResult | null },
  sent: AnswerInput[],
): LocalAttempt {
  const all = view.result !== null
  if (!all && view.stage !== 'handed_in' && view.stage !== 'over') return state
  const sentRev = new Map(sent.map((a) => [a.questionId, a.rev]))
  let answers: LocalAttempt['answers'] | null = null
  for (const [questionId, a] of Object.entries(state.answers)) {
    if (a.rev <= a.sentRev) continue
    if (!all && sentRev.get(questionId) !== a.rev) continue
    answers ??= { ...state.answers }
    answers[questionId] = { ...a, sentRev: a.rev }
  }
  return answers ? { ...state, answers } : state
}

// ---------------------------------------------------------------------------------------------
// Leaving, judged on the device as the server would
// ---------------------------------------------------------------------------------------------

/**
 * Exits counted so far: the server's count plus each queued exit whose `left` the server has not
 * acknowledged yet. A queued `back` alone means its `left` was acknowledged (left reports are
 * stored before anything else), so it is already in the server's count.
 */
export function exitCount(serverExits: number, queue: ExitReport[]): number {
  const fresh = new Set(queue.filter((e) => e.phase === 'left').map((e) => e.exitId))
  return serverExits + fresh.size
}

/**
 * Replays the queued reports through the leaving rule, like the server will: so a student who
 * reaches the limit sees the ended screen at once, even offline.
 */
export function localVerdict(rule: LeavingRule, serverExits: number, queue: ExitReport[]): Verdict {
  const counted = new Set<string>()
  let count = serverExits
  for (const e of queue) {
    let verdict: Verdict = 'continue'
    if (e.phase === 'left') {
      if (counted.has(e.exitId)) continue
      counted.add(e.exitId)
      count += 1
      verdict = judgeExit(rule, count, null)
    } else {
      counted.add(e.exitId)
      verdict = judgeExit(rule, count, e.awayMs)
    }
    if (verdict !== 'continue') return verdict
  }
  return 'continue'
}

// ---------------------------------------------------------------------------------------------
// When leaving counts
// ---------------------------------------------------------------------------------------------

/** The tracker runs only while answering: not before Start, after the end, a hand-in or an ending. */
export function tracksLeaving(s: { stage: AttemptStage; verdict: Verdict; timeUp: boolean; fatal: boolean }): boolean {
  return s.stage === 'answering' && s.verdict === 'continue' && !s.timeUp && !s.fatal
}

/**
 * Leaving counts from the first moment the student is present on the questions (C1): never on the
 * waiting screen, nor on Begin, so a student in another app when the lecturer presses Start has
 * not left. The warning screen only follows a counted exit, so it keeps counting.
 */
export function armsLeaving(screen: Screen): boolean {
  return screen === 'question' || screen === 'warning'
}

/** How this page was reached, and when it started (epoch ms). */
export type NavInfo = { type: string | null; startMs: number }

/**
 * From the Navigation Timing entry: when it is this page's own load, its type ('reload', 'navigate',
 * …) and the time origin. Reached inside the app (a client navigation after sign-in), the entry is
 * another page's: no type, and the page started when the runner mounted.
 */
export function navigationFor(input: {
  entry: { type: string; url: string } | null
  timeOriginMs: number
  currentPath: string
  mountedAtMs: number
}): NavInfo {
  let path: string | null = null
  try {
    path = input.entry ? new URL(input.entry.url).pathname : null
  } catch {
    path = null
  }
  if (input.entry && path === input.currentPath) return { type: input.entry.type, startMs: input.timeOriginMs }
  return { type: null, startMs: input.mountedAtMs }
}

/**
 * A reload starts the new page before the old one unloads (the `left` is stored as it unloads), so
 * a same-tab reload has the new page start at most this long after the stored leaving.
 */
export const RELOAD_GAP_MS = 3000

/**
 * An exit still open when the page opens (I1). A same-tab reload (pull-to-refresh, the reload
 * button) is not leaving: its `left` is dropped while the server has not heard of it, or else
 * comes back at once with the time up to the new page start. A tab closed and reopened counts,
 * the absence measured to when the new page started (not to when the server answered, which on
 * weak data can take longer than the limit). A page opened hidden is judged when it shows.
 */
export function resolveOpenExit(input: {
  openExit: OpenExit
  nav: NavInfo
  visible: boolean
  /** The exit's `left` is still queued on the device: the server has not counted it. */
  leftQueued: boolean
}): { kind: 'drop' } | { kind: 'back'; awayMs: number } | { kind: 'wait' } {
  const sinceLeft = input.nav.startMs - input.openExit.leftAtEpochMs
  const awayMs = Math.min(MAX_AWAY_MS, Math.max(0, Math.round(sinceLeft)))
  const reload = input.nav.type === 'reload' && sinceLeft <= RELOAD_GAP_MS
  if (reload) return input.leftQueued ? { kind: 'drop' } : { kind: 'back', awayMs }
  if (!input.visible) return { kind: 'wait' }
  return { kind: 'back', awayMs }
}

// ---------------------------------------------------------------------------------------------
// Sync line, local copy
// ---------------------------------------------------------------------------------------------

/**
 * What screen readers hear of the sync line: each problem, and "Saved" once after a problem; the
 * Saved / Saving round that every answer causes stays silent. `spoken` is what was last said; the
 * line is live while the status shown is the one to say.
 */
export function spokenSyncStatus(spoken: SyncStatus | null, next: SyncStatus): SyncStatus | null {
  if (next === 'saving') return spoken
  if (next === 'saved') return spoken === null || spoken === 'saved' ? null : 'saved'
  return next
}

/**
 * The device copy can go: after a hand-in (final on the server), once a result shows, or once
 * nothing more will be sent (the attempt is over and nothing is queued).
 */
export function clearsLocalCopy(
  view: { stage: AttemptStage; attemptId: string | null; hasShort: boolean; result: QuickResult | null; awaitingRelease: boolean },
  hasPending: boolean,
): boolean {
  if (view.stage === 'handed_in' || view.result !== null) return true
  return !keepSyncing(view, hasPending)
}

/** Why the server ended the attempt (the view does not say): the exits, or else one long absence. */
export function endReason(rule: LeavingRule, exitsSoFar: number): 'exits' | 'absence' {
  return exitsSoFar >= rule.maxExits ? 'exits' : 'absence'
}

// ---------------------------------------------------------------------------------------------
// Screens
// ---------------------------------------------------------------------------------------------

export type Screen = 'waiting' | 'begin' | 'question' | 'warning' | 'ended' | 'result' | 'closed'

export type ScreenInput = {
  stage: AttemptStage
  attemptId: string | null
  verdict: Verdict
  /** Laptop with full screen support that has not tapped Begin yet. */
  needsBegin: boolean
  /** Came back from leaving and has not dismissed the warning. */
  hasWarning: boolean
  /** The countdown reached 0: inputs lock while the answers go in. */
  timeUp: boolean
}

export function screenFor(s: ScreenInput): Screen {
  switch (s.stage) {
    case 'waiting':
      return 'waiting'
    case 'answering':
      if (s.verdict !== 'continue') return 'ended'
      if (s.timeUp) return 'question'
      if (s.hasWarning) return 'warning'
      if (s.needsBegin) return 'begin'
      return 'question'
    case 'ended_left':
      return 'ended'
    case 'handed_in':
      return 'result'
    case 'over':
      return s.attemptId === null ? 'closed' : 'result'
  }
}

/**
 * What the result screen shows. The total only ever appears once the answers are final; until then
 * an MCQ-only test says it is on its way, a test with short answers waits for the release.
 */
export function resultState(view: { hasShort: boolean; result: QuickResult | null }): 'score' | 'pending' | 'awaiting_release' {
  if (view.result !== null) return 'score'
  return view.hasShort ? 'awaiting_release' : 'pending'
}

// ---------------------------------------------------------------------------------------------
// Display and hand-in
// ---------------------------------------------------------------------------------------------

/** "mm:ss", or "h:mm:ss" from an hour; rounded up so 0 shows only when time is really up. */
export function formatCountdown(ms: number): string {
  const total = Math.max(0, Math.ceil(ms / 1000))
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const s = total % 60
  const mm = String(m).padStart(2, '0')
  const ss = String(s).padStart(2, '0')
  return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`
}

/** Every local answer: the hand-in carries them all (the server ignores revs it already has). */
export function allAnswers(state: LocalAttempt): AnswerInput[] {
  return Object.entries(state.answers).map(([questionId, a]) => ({
    questionId,
    optionId: a.optionId,
    text: a.text,
    rev: a.rev,
  }))
}
