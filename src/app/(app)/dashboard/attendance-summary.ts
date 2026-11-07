import type { AttendanceStatus } from '@/server/attendance/status'

const MINUTE = 60 * 1000
const WEEK = 7 * 24 * 60 * MINUTE
/** How far from "this time last week" a session may have started and still suggest this class. */
const LIKELY_WINDOW = 60 * MINUTE

export type LastSession = { createdAt: Date; attended: number; total: number }

/**
 * The newest session's turnout for a course card: present and partial students out of everyone
 * enrolled at the time. `sessions` come oldest first, as the attendance grid returns them.
 */
export function lastSessionFigure(
  sessions: readonly { id: string; createdAt: Date }[],
  rows: readonly { statuses: Readonly<Record<string, AttendanceStatus | null>> }[],
): LastSession | null {
  const last = sessions.at(-1)
  if (!last) return null
  let attended = 0
  let total = 0
  for (const { statuses } of rows) {
    const status = statuses[last.id]
    if (status === 'not_enrolled') continue
    total += 1
    if (status === 'present' || status === 'partial') attended += 1
  }
  return { createdAt: last.createdAt, attended, total }
}

/**
 * Clasync has no timetable, so the dashboard guesses the class happening now: a course whose
 * session started on this weekday last week, within an hour of the current time. Closest wins.
 */
export function pickLikelyNow(
  sessions: readonly { courseId: string; createdAt: Date }[],
  now: Date,
): { courseId: string; startedAt: Date } | null {
  const target = now.getTime() - WEEK
  let best: { courseId: string; startedAt: Date; distance: number } | null = null
  for (const { courseId, createdAt } of sessions) {
    const distance = Math.abs(createdAt.getTime() - target)
    if (distance > LIKELY_WINDOW) continue
    if (!best || distance < best.distance) best = { courseId, startedAt: createdAt, distance }
  }
  return best && { courseId: best.courseId, startedAt: best.startedAt }
}
