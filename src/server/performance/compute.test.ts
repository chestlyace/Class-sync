import { describe, expect, it } from 'vitest'
import { type CaInput, computeCa, isSlipping, rankRows } from './compute'
import { DEFAULT_SETTINGS } from './rules'

const EMPTY: CaInput = {
  attendance: { present: 0, partial: 0, absent: 0 },
  assignments: [],
  participationNet: 0,
  classHasParticipation: false,
}

const part = (r: ReturnType<typeof computeCa>, key: string) => r.components.find((c) => c.key === key)!

describe('computeCa', () => {
  it('shows every component as not started, 0 so far and 0 / 30 final for empty input', () => {
    const r = computeCa(DEFAULT_SETTINGS, EMPTY)
    expect(r.components).toEqual([
      { key: 'attendance', points: 5, ratio: null, score: null },
      { key: 'assignments', points: 20, ratio: null, score: null },
      { key: 'participation', points: 5, ratio: null, score: null },
    ])
    expect(r.soFar).toBe(0)
    expect(r.soFarOutOf).toBe(0)
    expect(r.final).toBe(0)
    expect(r.total).toBe(30)
  })

  it('scores attendance as (present + half partial) over counted sessions', () => {
    const r = computeCa(DEFAULT_SETTINGS, { ...EMPTY, attendance: { present: 4, partial: 2, absent: 2 } })
    const a = part(r, 'attendance')
    expect(a.ratio).toBe(0.625)
    expect(a.score).toBe(3.13)
    expect(r.soFar).toBe(3.13)
    expect(r.soFarOutOf).toBe(5)
    expect(r.final).toBe(3.13)
  })

  it('scores assignments by weight, counting a missing mark as 0', () => {
    const r = computeCa(DEFAULT_SETTINGS, {
      ...EMPTY,
      assignments: [
        { weight: 1, mark: 15, maxMark: 20 },
        { weight: 2, mark: 8, maxMark: 10 },
        { weight: 1, mark: null, maxMark: 10 },
      ],
    })
    const a = part(r, 'assignments')
    expect(a.ratio).toBeCloseTo(0.5875, 10)
    expect(a.score).toBe(11.75)
  })

  it('counts a released assignment with only missing marks as started at 0', () => {
    const r = computeCa(DEFAULT_SETTINGS, { ...EMPTY, assignments: [{ weight: 1, mark: null, maxMark: 20 }] })
    expect(part(r, 'assignments')).toMatchObject({ ratio: 0, score: 0 })
    expect(r.soFarOutOf).toBe(20)
  })

  it('does not divide by zero on zero weights or zero max marks', () => {
    const zeroWeight = computeCa(DEFAULT_SETTINGS, { ...EMPTY, assignments: [{ weight: 0, mark: 5, maxMark: 10 }] })
    expect(part(zeroWeight, 'assignments').ratio).toBeNull()
    const zeroMax = computeCa(DEFAULT_SETTINGS, { ...EMPTY, assignments: [{ weight: 1, mark: 0, maxMark: 0 }] })
    expect(part(zeroMax, 'assignments').score).toBe(0)
  })

  it('caps participation at the target and floors it at 0', () => {
    const over = computeCa(DEFAULT_SETTINGS, { ...EMPTY, participationNet: 7, classHasParticipation: true })
    expect(part(over, 'participation')).toMatchObject({ ratio: 1, score: 5 })
    const under = computeCa(DEFAULT_SETTINGS, { ...EMPTY, participationNet: -2, classHasParticipation: true })
    expect(part(under, 'participation')).toMatchObject({ ratio: 0, score: 0 })
    const half = computeCa({ ...DEFAULT_SETTINGS, participationTarget: 10 }, { ...EMPTY, participationNet: 4, classHasParticipation: true })
    expect(part(half, 'participation')).toMatchObject({ ratio: 0.4, score: 2 })
  })

  it('treats participation as started for everyone once the class has any taps, not before', () => {
    const notYet = computeCa(DEFAULT_SETTINGS, { ...EMPTY, participationNet: 0, classHasParticipation: false })
    expect(part(notYet, 'participation')).toMatchObject({ ratio: null, score: null })
    const started = computeCa(DEFAULT_SETTINGS, { ...EMPTY, participationNet: 0, classHasParticipation: true })
    expect(part(started, 'participation')).toMatchObject({ ratio: 0, score: 0 })
    expect(started.soFarOutOf).toBe(5)
  })

  it('omits components with 0 points', () => {
    const settings = { ...DEFAULT_SETTINGS, assignmentPoints: 25, participationPoints: 0 }
    const r = computeCa(settings, { ...EMPTY, participationNet: 3, classHasParticipation: true })
    expect(r.components.map((c) => c.key)).toEqual(['attendance', 'assignments'])
  })

  it('sums started components for so-far and treats unstarted ones as 0 in final', () => {
    const r = computeCa(DEFAULT_SETTINGS, {
      ...EMPTY,
      attendance: { present: 1, partial: 0, absent: 0 },
      participationNet: 5,
      classHasParticipation: true,
    })
    expect(r.soFar).toBe(10)
    expect(r.soFarOutOf).toBe(10)
    expect(r.final).toBe(10)
    expect(r.total).toBe(30)
  })

  it('rounds only at the end', () => {
    // Each half-point score is 0.505 (shown 0.51); summed unrounded they make 1.515 -> 1.52, not 0.51 * 3 = 1.53.
    const half = computeCa(
      { total: 3.03, attendancePoints: 1.01, assignmentPoints: 1.01, participationPoints: 1.01, testPoints: 0, participationTarget: 2 },
      {
        attendance: { present: 1, partial: 0, absent: 1 },
        assignments: [{ weight: 1, mark: 1, maxMark: 2 }],
        participationNet: 1,
        classHasParticipation: true,
      },
    )
    expect(half.components.map((c) => c.score)).toEqual([0.51, 0.51, 0.51])
    expect(half.soFar).toBe(1.52)
    expect(half.final).toBe(1.52)
    // three ratios of 1/3 each score 1.67 (sum 5.01 if rounded first) but 5 in total
    const thirds = computeCa(
      { total: 15, attendancePoints: 5, assignmentPoints: 5, participationPoints: 5, testPoints: 0, participationTarget: 3 },
      {
        attendance: { present: 1, partial: 0, absent: 2 },
        assignments: [{ weight: 1, mark: 1, maxMark: 3 }],
        participationNet: 1,
        classHasParticipation: true,
      },
    )
    expect(thirds.components.map((c) => c.score)).toEqual([1.67, 1.67, 1.67])
    expect(thirds.soFar).toBe(5)
    expect(thirds.final).toBe(5)
  })

  it('rounds .005 cases up despite float representation', () => {
    const settings = { ...DEFAULT_SETTINGS, attendancePoints: 1.005, assignmentPoints: 18.995, participationPoints: 5 }
    const r = computeCa(settings, { ...EMPTY, attendance: { present: 1, partial: 0, absent: 0 } })
    expect(part(r, 'attendance').score).toBe(1.01)
  })
})

describe('rankRows', () => {
  it('ranks by final descending then name, ties sharing a rank', () => {
    const rows = [
      { name: 'Zed', final: 10 },
      { name: 'Ada', final: 12 },
      { name: 'Bea', final: 10 },
      { name: 'Cy', final: 5 },
    ]
    expect(rankRows(rows)).toEqual([
      { name: 'Ada', final: 12, rank: 1 },
      { name: 'Bea', final: 10, rank: 2 },
      { name: 'Zed', final: 10, rank: 2 },
      { name: 'Cy', final: 5, rank: 4 },
    ])
  })

  it('does not mutate its input and handles empty', () => {
    const rows = [{ name: 'B', final: 1 }, { name: 'A', final: 2 }]
    rankRows(rows)
    expect(rows[0].name).toBe('B')
    expect(rankRows([])).toEqual([])
  })
})

describe('isSlipping', () => {
  const result = (soFar: number, soFarOutOf: number) => ({ components: [], soFar, soFarOutOf, final: soFar, total: 30 })

  it('flags CA so far below half of its points', () => {
    expect(isSlipping(result(4.999, 10), null, 0)).toBe(true)
    expect(isSlipping(result(5, 10), null, 0)).toBe(false)
  })

  it('never flags on CA when nothing has started', () => {
    expect(isSlipping(result(0, 0), null, 0)).toBe(false)
  })

  it('flags attendance below 0.75 only with at least 3 counted sessions', () => {
    expect(isSlipping(result(10, 10), 0.74, 2)).toBe(false)
    expect(isSlipping(result(10, 10), 0.74, 3)).toBe(true)
    expect(isSlipping(result(10, 10), 0.75, 3)).toBe(false)
    expect(isSlipping(result(10, 10), null, 5)).toBe(false)
  })
})
