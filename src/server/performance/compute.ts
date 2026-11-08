import { type CaSettings, SLIP_ATTENDANCE, SLIP_MIN_SESSIONS, SLIP_MIN_SHARE, SLIP_RATIO } from './rules'

export type ComponentKey = 'attendance' | 'assignments' | 'participation'

/**
 * - `scored`: the part has started for the class and counts for this student.
 * - `not_started`: nobody in the class has anything counted there yet; it counts 0 for everyone.
 * - `not_applicable`: it has started for the class, but nothing counts for this student yet (only
 *   work waiting for a grade, only work due before they joined, or no session since they joined).
 *   Left out of their final, whose other parts are scaled up to the total.
 */
export type PartStatus = 'scored' | 'not_started' | 'not_applicable'

/** `ratio` and `score` are null unless the part is `scored`. */
export type ComponentScore = {
  key: ComponentKey
  points: number
  ratio: number | null
  score: number | null
  status: PartStatus
}

export type CaInput = {
  attendance: { present: number; partial: number; absent: number }
  /** Released assignments only; `mark: null` = missing = counts 0. */
  assignments: { weight: number; mark: number | null; maxMark: number }[]
  participationNet: number
  /**
   * Which parts have started for the class (the current roster): attendance once anyone has a
   * counted session, assignments once a published assignment has its grades released,
   * participation once anyone on the roster has a tap.
   */
  classStarted: Record<ComponentKey, boolean>
}

export type CaResult = {
  components: ComponentScore[]
  soFar: number
  soFarOutOf: number
  final: number
  total: number
  /** Some part doesn't apply to the student, so the final is scaled up to the total. */
  scaled: boolean
  /** No part applies to the student at all: the final is 0 and means "not assessed yet". */
  notAssessed: boolean
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

function participationRatio(net: number, target: number): number {
  return Math.min(1, Math.max(0, net) / target)
}

/**
 * Computes one student's CA. The parts add up: each scored part is `points × ratio` rounded to
 * 2 decimals, and the final is the sum of those rounded parts. A part that doesn't apply to the
 * student is left out and the sum is scaled by total / (total − its points), then rounded again;
 * a part the class hasn't started counts 0 (it is not scaled over). "So far" is the scored parts
 * out of their own points, never scaled.
 */
export function computeCa(settings: CaSettings, input: CaInput): CaResult {
  const specs: { key: ComponentKey; points: number; ratio: number | null }[] = [
    { key: 'attendance', points: settings.attendancePoints, ratio: attendanceRatio(input.attendance) },
    { key: 'assignments', points: settings.assignmentPoints, ratio: assignmentsRatio(input.assignments) },
    {
      key: 'participation',
      points: settings.participationPoints,
      ratio: participationRatio(input.participationNet, settings.participationTarget),
    },
  ]

  let earned = 0
  let outOf = 0
  let naPoints = 0
  const components: ComponentScore[] = []
  for (const { key, points, ratio } of specs) {
    if (points <= 0) continue
    if (!input.classStarted[key]) {
      components.push({ key, points, ratio: null, score: null, status: 'not_started' })
    } else if (ratio === null) {
      naPoints += points
      components.push({ key, points, ratio: null, score: null, status: 'not_applicable' })
    } else {
      const score = round2(points * ratio)
      earned += score
      outOf += points
      components.push({ key, points, ratio, score, status: 'scored' })
    }
  }

  const total = settings.total
  const soFar = round2(earned)
  const result = { components, soFar, soFarOutOf: round2(outOf), total }
  if (naPoints === 0) return { ...result, final: soFar, scaled: false, notAssessed: false }
  const applicable = round2(total - naPoints)
  if (applicable <= 0) return { ...result, final: 0, scaled: true, notAssessed: true }
  return { ...result, final: round2((soFar * total) / applicable), scaled: true, notAssessed: false }
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

/**
 * Slipping: CA so far under half its points, once the parts so far are worth at least a quarter of
 * the total (too early otherwise); or attendance under 0.75 after enough counted sessions.
 */
export function isSlipping(result: CaResult, attendanceRatio: number | null, countedSessions: number): boolean {
  const enoughSoFar = result.soFarOutOf > 0 && result.soFarOutOf >= SLIP_MIN_SHARE * result.total
  if (enoughSoFar && result.soFar < SLIP_RATIO * result.soFarOutOf) return true
  return attendanceRatio !== null && countedSessions >= SLIP_MIN_SESSIONS && attendanceRatio < SLIP_ATTENDANCE
}
