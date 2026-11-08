import { type CaSettings, SLIP_ATTENDANCE, SLIP_MIN_SESSIONS, SLIP_RATIO } from './rules'

export type ComponentKey = 'attendance' | 'assignments' | 'participation'

/** `ratio` and `score` are null when the component has not started. */
export type ComponentScore = { key: ComponentKey; points: number; ratio: number | null; score: number | null }

export type CaInput = {
  attendance: { present: number; partial: number; absent: number }
  /** Released assignments only; `mark: null` = missing = counts 0. */
  assignments: { weight: number; mark: number | null; maxMark: number }[]
  participationNet: number
  /** Whether anyone in the class has a participation tap yet. */
  classHasParticipation: boolean
}

export type CaResult = {
  components: ComponentScore[]
  soFar: number
  soFarOutOf: number
  final: number
  total: number
}

/** Rounds to 2 decimals; the epsilon makes .005 cases (1.005) round up despite float error. */
function round2(x: number): number {
  return Math.round(x * 100 + 1e-7) / 100
}

/** (present + 0.5 × partial) / counted sessions; null when no session counts yet. */
export function attendanceRatio(a: CaInput['attendance']): number | null {
  const counted = a.present + a.partial + a.absent
  return counted > 0 ? (a.present + 0.5 * a.partial) / counted : null
}

function assignmentsRatio(list: CaInput['assignments']): number | null {
  const totalWeight = list.reduce((sum, a) => sum + a.weight, 0)
  if (list.length === 0 || totalWeight <= 0) return null
  const earned = list.reduce(
    (sum, a) => sum + (a.mark === null || a.maxMark <= 0 ? 0 : (a.weight * a.mark) / a.maxMark),
    0,
  )
  return earned / totalWeight
}

function participationRatio(input: CaInput, target: number): number | null {
  if (!input.classHasParticipation) return null
  return Math.min(1, Math.max(0, input.participationNet) / target)
}

/**
 * Computes one student's CA. Ratios and scores keep full precision; only the reported
 * numbers (component scores, soFar, final) are rounded to 2 decimals, at the end.
 */
export function computeCa(settings: CaSettings, input: CaInput): CaResult {
  const specs: { key: ComponentKey; points: number; ratio: number | null }[] = [
    { key: 'attendance', points: settings.attendancePoints, ratio: attendanceRatio(input.attendance) },
    { key: 'assignments', points: settings.assignmentPoints, ratio: assignmentsRatio(input.assignments) },
    {
      key: 'participation',
      points: settings.participationPoints,
      ratio: participationRatio(input, settings.participationTarget),
    },
  ]

  let earned = 0
  let outOf = 0
  const components: ComponentScore[] = []
  for (const { key, points, ratio } of specs) {
    if (points <= 0) continue
    const raw = ratio === null ? null : points * ratio
    if (raw !== null) {
      earned += raw
      outOf += points
    }
    components.push({ key, points, ratio, score: raw === null ? null : round2(raw) })
  }

  // Unstarted components count 0 in the final, so soFar and final are the same earned sum.
  return { components, soFar: round2(earned), soFarOutOf: round2(outOf), final: round2(earned), total: settings.total }
}

/** Highest final first, then name; equal finals share a rank (1, 2, 2, 4). */
export function rankRows<T extends { final: number; name: string }>(rows: T[]): (T & { rank: number })[] {
  const sorted = [...rows].sort((a, b) => b.final - a.final || a.name.localeCompare(b.name))
  let rank = 0
  return sorted.map((row, i) => {
    if (i === 0 || row.final !== sorted[i - 1].final) rank = i + 1
    return { ...row, rank }
  })
}

export function isSlipping(result: CaResult, attendanceRatio: number | null, countedSessions: number): boolean {
  if (result.soFarOutOf > 0 && result.soFar < SLIP_RATIO * result.soFarOutOf) return true
  return attendanceRatio !== null && countedSessions >= SLIP_MIN_SESSIONS && attendanceRatio < SLIP_ATTENDANCE
}
