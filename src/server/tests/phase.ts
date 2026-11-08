import { ANSWER_GRACE_MS } from './rules'

export type TestTiming = { startedAt: Date | null; deadlineAt: Date | null; endedAt: Date | null }
export type TestPhase = 'not_started' | 'running' | 'ended'
export type TestState = TestPhase | 'released'

/** When the test ends for everyone: the earlier of the deadline and a manual end. */
export function endsAt(t: TestTiming): Date | null {
  const times = [t.deadlineAt, t.endedAt].filter((d): d is Date => d !== null)
  if (times.length === 0) return null
  return new Date(Math.min(...times.map((d) => d.getTime())))
}

/** The last moment (exclusive) an answer still counts: the end plus the grace. */
export function answersFinalAt(t: TestTiming): Date | null {
  const end = endsAt(t)
  return end ? new Date(end.getTime() + ANSWER_GRACE_MS) : null
}

/** Not started until Start; running until the end (exclusive); ended from then on. */
export function testPhase(t: TestTiming, at: Date): TestPhase {
  if (t.startedAt === null || at.getTime() < t.startedAt.getTime()) return 'not_started'
  const end = endsAt(t)
  if (end !== null && at.getTime() >= end.getTime()) return 'ended'
  return 'running'
}

/** Ended tests are released at once when MCQ-only, otherwise when the lecturer releases them. */
export function testState(
  t: TestTiming & { resultsReleasedAt: Date | null; hasShort: boolean },
  at: Date,
): TestState {
  const phase = testPhase(t, at)
  if (phase === 'ended' && (!t.hasShort || t.resultsReleasedAt !== null)) return 'released'
  return phase
}

/**
 * Whether the server keeps an answer received at `at`: never before Start (questions may still
 * change) nor after a hand-in; otherwise until the test's end plus the grace, and for an attempt
 * ended for leaving also until its own closing plus the grace, whichever comes first.
 */
export function acceptsAnswers(
  t: TestTiming,
  attempt: { closedAt: Date | null; closedReason: 'handed_in' | 'left' | null },
  at: Date,
): boolean {
  if (testPhase(t, at) === 'not_started') return false
  if (attempt.closedReason === 'handed_in') return false
  const finalAt = answersFinalAt(t)
  if (finalAt !== null && at.getTime() >= finalAt.getTime()) return false
  if (attempt.closedAt !== null && at.getTime() >= attempt.closedAt.getTime() + ANSWER_GRACE_MS) {
    return false
  }
  return true
}

/**
 * Whether a student may see their result. With short answers: only once released. MCQ-only: at
 * once after a hand-in; ended for leaving (or still working) only once the test has ended.
 */
export function canSeeResult(input: {
  hasShort: boolean
  phase: TestPhase
  closedReason: 'handed_in' | 'left' | null
  released: boolean
}): boolean {
  if (input.hasShort) return input.released
  if (input.closedReason === 'handed_in') return true
  return input.phase === 'ended'
}
