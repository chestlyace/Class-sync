export type AttendanceStatus = 'present' | 'partial' | 'absent' | 'not_enrolled'
export type OverrideStatus = 'present' | 'partial' | 'absent'

export type StatusInput = {
  startOpened: boolean
  endOpened: boolean
  checkedStart: boolean
  checkedEnd: boolean
  enrolled: boolean
  override: OverrideStatus | null
}

/**
 * A student's status for one session. A lecturer override wins, then enrolment; with no
 * window opened there is nothing to judge (null). When both windows opened both checks are
 * needed for present; when only one opened, that one check is enough.
 */
export function computeStatus(input: StatusInput): AttendanceStatus | null {
  if (input.override) return input.override
  if (!input.enrolled) return 'not_enrolled'
  const { startOpened, endOpened, checkedStart, checkedEnd } = input
  if (!startOpened && !endOpened) return null
  const required = (startOpened ? 1 : 0) + (endOpened ? 1 : 0)
  const done = (startOpened && checkedStart ? 1 : 0) + (endOpened && checkedEnd ? 1 : 0)
  if (done === required) return 'present'
  return done === 0 ? 'absent' : 'partial'
}

/** Totals over a class; sessions with no status and non-enrolled students don't count. */
export function summarize(statuses: (AttendanceStatus | null)[]): {
  present: number
  partial: number
  absent: number
} {
  const totals = { present: 0, partial: 0, absent: 0 }
  for (const s of statuses) {
    if (s === 'present' || s === 'partial' || s === 'absent') totals[s]++
  }
  return totals
}
