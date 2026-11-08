// Pure and import-free: the student's test runner uses it in the browser as well.

export type LeavingRule = { maxExits: number; maxAbsenceSeconds: number }

/**
 * Judges one exit. `exitsSoFar` counts this exit; `awayMs` is the absence measured on the device,
 * or `null` while the student has not come back. The Nth exit ends the attempt at once; an
 * absence of exactly S seconds is allowed, longer ends it.
 */
export function judgeExit(
  rule: LeavingRule,
  exitsSoFar: number,
  awayMs: number | null,
): 'continue' | 'end_exits' | 'end_absence' {
  if (exitsSoFar >= rule.maxExits) return 'end_exits'
  if (awayMs !== null && awayMs > rule.maxAbsenceSeconds * 1000) return 'end_absence'
  return 'continue'
}
