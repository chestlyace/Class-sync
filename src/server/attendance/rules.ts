/** How long one rotating attendance code stays current. */
export const CODE_TTL_SECONDS = 60
/** After a rotation the previous code is still accepted for this long. */
export const CODE_GRACE_SECONDS = 10
/** The longest a lecturer can keep a window open. */
export const WINDOW_MAX_MINUTES = 15
/** Wrong codes a student may submit per window before being locked out. */
export const MAX_CODE_FAILURES = 10
/** A position fix less precise than this is rejected outright. */
export const MAX_LOCATION_ACCURACY_M = 1000
/** At most this much of a fix's reported accuracy is forgiven against the campus radius. */
export const ACCURACY_ALLOWANCE_CAP_M = 150
/** Lecturer live view refresh interval. */
export const LIVE_POLL_MS = 3000
/** Student screen refresh interval. */
export const STUDENT_POLL_MS = 15000
/** A session is over (no more windows can be opened) this long after it was created. */
export const SESSION_MAX_HOURS = 12

/** Whether a session created at `createdAt` is over at `at` (timezone-free: 12 h of wall time). */
export function isSessionOver(createdAt: Date, at: Date): boolean {
  return at.getTime() - createdAt.getTime() > SESSION_MAX_HOURS * 3_600_000
}
