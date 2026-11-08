export const DEFAULT_SETTINGS = {
  total: 30,
  attendancePoints: 5,
  assignmentPoints: 20,
  participationPoints: 5,
  testPoints: 0,
  participationTarget: 5,
}

export type CaSettings = typeof DEFAULT_SETTINGS

export type SettingsError = { error: 'sum' | 'range' | 'decimals' | 'shape' }

/** A student whose CA so far is below this share of its points is slipping. */
export const SLIP_RATIO = 0.5
/** Attendance ratio below this (with enough counted sessions) is slipping. */
export const SLIP_ATTENDANCE = 0.75
export const SLIP_MIN_SESSIONS = 3

const POINT_KEYS = ['attendancePoints', 'assignmentPoints', 'participationPoints', 'testPoints'] as const
const MAX_POINTS = 100

const cents = (n: number) => Math.round(n * 100)
const hasAtMostTwoDecimals = (n: number) => Math.abs(n * 100 - cents(n)) < 1e-6

/**
 * Checks a course's CA settings. Numbers only: the action layer converts form strings first.
 * Returns the parsed settings (known fields only) or why they were refused.
 */
export function validateSettings(input: unknown): CaSettings | SettingsError {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) return { error: 'shape' }
  const o = input as Record<string, unknown>
  for (const key of ['total', ...POINT_KEYS, 'participationTarget']) {
    if (typeof o[key] !== 'number' || !Number.isFinite(o[key])) return { error: 'shape' }
  }
  const s: CaSettings = {
    total: o.total as number,
    attendancePoints: o.attendancePoints as number,
    assignmentPoints: o.assignmentPoints as number,
    participationPoints: o.participationPoints as number,
    testPoints: o.testPoints as number,
    participationTarget: o.participationTarget as number,
  }

  if (s.total < 1 || s.total > MAX_POINTS) return { error: 'range' }
  if (POINT_KEYS.some((k) => s[k] < 0 || s[k] > MAX_POINTS)) return { error: 'range' }
  if (!Number.isInteger(s.participationTarget) || s.participationTarget < 1 || s.participationTarget > MAX_POINTS) {
    return { error: 'range' }
  }
  if (!hasAtMostTwoDecimals(s.total) || POINT_KEYS.some((k) => !hasAtMostTwoDecimals(s[k]))) {
    return { error: 'decimals' }
  }
  if (POINT_KEYS.reduce((sum, k) => sum + cents(s[k]), 0) !== cents(s.total)) return { error: 'sum' }
  return s
}
