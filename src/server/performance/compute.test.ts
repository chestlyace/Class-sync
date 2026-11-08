import { describe, expect, it } from 'vitest'
import { type CaInput, computeCa, isSlipping, rankRows } from './compute'
import { type CaSettings, DEFAULT_SETTINGS } from './rules'

const EMPTY: CaInput = {
  attendance: { present: 0, partial: 0, absent: 0 },
  assignments: [],
  participationNet: 0,
  tests: [],
  classStarted: { attendance: false, assignments: false, participation: false, tests: false },
}

const ALL_STARTED: CaInput['classStarted'] = { attendance: true, assignments: true, participation: true, tests: true }

const part = (r: ReturnType<typeof computeCa>, key: string) => r.components.find((c) => c.key === key)!

describe('computeCa', () => {
  it('shows every component as not started, 0 so far and 0 / 30 final for empty input', () => {
    const r = computeCa(DEFAULT_SETTINGS, EMPTY)
    expect(r.components).toEqual([
      { key: 'attendance', points: 5, ratio: null, score: null, status: 'not_started' },
      { key: 'assignments', points: 20, ratio: null, score: null, status: 'not_started' },
      { key: 'participation', points: 5, ratio: null, score: null, status: 'not_started' },
    ])
    expect(r.soFar).toBe(0)
    expect(r.soFarOutOf).toBe(0)
    expect(r.final).toBe(0)
    expect(r.total).toBe(30)
    expect(r.scaled).toBe(false)
    expect(r.notAssessed).toBe(false)
  })

  it('scores attendance as (present + half partial) over counted sessions', () => {
    const r = computeCa(DEFAULT_SETTINGS, {
      ...EMPTY,
      attendance: { present: 4, partial: 2, absent: 2 },
      classStarted: { ...EMPTY.classStarted, attendance: true },
    })
    const a = part(r, 'attendance')
    expect(a.ratio).toBe(0.625)
    expect(a.score).toBe(3.13)
    expect(a.status).toBe('scored')
    expect(r.soFar).toBe(3.13)
    expect(r.soFarOutOf).toBe(5)
    expect(r.final).toBe(3.13)
  })

  it('scores assignments by weight, counting a missing mark as 0', () => {
    const r = computeCa(DEFAULT_SETTINGS, {
      ...EMPTY,
      classStarted: ALL_STARTED,
      attendance: { present: 1, partial: 0, absent: 0 },
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
    const r = computeCa(DEFAULT_SETTINGS, {
      ...EMPTY,
      classStarted: { ...EMPTY.classStarted, assignments: true },
      assignments: [{ weight: 1, mark: null, maxMark: 20 }],
    })
    expect(part(r, 'assignments')).toMatchObject({ ratio: 0, score: 0, status: 'scored' })
    expect(r.soFarOutOf).toBe(20)
    expect(r.scaled).toBe(false)
  })

  it('does not divide by zero on zero weights or zero max marks', () => {
    const started = { ...EMPTY.classStarted, assignments: true }
    const zeroWeight = computeCa(DEFAULT_SETTINGS, {
      ...EMPTY,
      classStarted: started,
      assignments: [{ weight: 0, mark: 5, maxMark: 10 }],
    })
    expect(part(zeroWeight, 'assignments').ratio).toBeNull()
    const zeroMax = computeCa(DEFAULT_SETTINGS, {
      ...EMPTY,
      classStarted: started,
      assignments: [{ weight: 1, mark: 0, maxMark: 0 }],
    })
    expect(part(zeroMax, 'assignments').score).toBe(0)
  })

  it('caps participation at the target and floors it at 0', () => {
    const started = { ...EMPTY, classStarted: { ...EMPTY.classStarted, participation: true } }
    const over = computeCa(DEFAULT_SETTINGS, { ...started, participationNet: 7 })
    expect(part(over, 'participation')).toMatchObject({ ratio: 1, score: 5 })
    const under = computeCa(DEFAULT_SETTINGS, { ...started, participationNet: -2 })
    expect(part(under, 'participation')).toMatchObject({ ratio: 0, score: 0 })
    const half = computeCa({ ...DEFAULT_SETTINGS, participationTarget: 10 }, { ...started, participationNet: 4 })
    expect(part(half, 'participation')).toMatchObject({ ratio: 0.4, score: 2 })
  })

  it('treats participation as started for everyone once the class has any taps, not before', () => {
    const notYet = computeCa(DEFAULT_SETTINGS, { ...EMPTY, participationNet: 0 })
    expect(part(notYet, 'participation')).toMatchObject({ ratio: null, score: null, status: 'not_started' })
    const started = computeCa(DEFAULT_SETTINGS, {
      ...EMPTY,
      participationNet: 0,
      classStarted: { ...EMPTY.classStarted, participation: true },
    })
    expect(part(started, 'participation')).toMatchObject({ ratio: 0, score: 0, status: 'scored' })
    expect(started.soFarOutOf).toBe(5)
  })

  it('omits components with 0 points', () => {
    const settings = { ...DEFAULT_SETTINGS, assignmentPoints: 25, participationPoints: 0 }
    const r = computeCa(settings, { ...EMPTY, participationNet: 3, classStarted: ALL_STARTED })
    expect(r.components.map((c) => c.key)).toEqual(['attendance', 'assignments'])
  })

  it('counts a part the class has not started as 0 for everyone, without scaling', () => {
    const r = computeCa(DEFAULT_SETTINGS, {
      ...EMPTY,
      attendance: { present: 1, partial: 0, absent: 0 },
      participationNet: 5,
      classStarted: { attendance: true, assignments: false, participation: true, tests: false },
    })
    expect(part(r, 'assignments')).toEqual({ key: 'assignments', points: 20, ratio: null, score: null, status: 'not_started' })
    expect(r.soFar).toBe(10)
    expect(r.soFarOutOf).toBe(10)
    expect(r.final).toBe(10)
    expect(r.total).toBe(30)
    expect(r.scaled).toBe(false)
  })

  it('scales the other parts up to the total when a started part does not apply to the student', () => {
    // Assignments have started for the class, but this student has nothing counted there yet.
    const r = computeCa(DEFAULT_SETTINGS, {
      ...EMPTY,
      attendance: { present: 1, partial: 0, absent: 1 },
      participationNet: 3,
      classStarted: ALL_STARTED,
    })
    expect(part(r, 'assignments')).toEqual({
      key: 'assignments',
      points: 20,
      ratio: null,
      score: null,
      status: 'not_applicable',
    })
    expect(part(r, 'attendance')).toMatchObject({ score: 2.5, status: 'scored' })
    expect(part(r, 'participation')).toMatchObject({ score: 3, status: 'scored' })
    // (2.5 + 3) x 30 / (30 - 20) = 16.5
    expect(r.final).toBe(16.5)
    expect(r.scaled).toBe(true)
    expect(r.notAssessed).toBe(false)
    // So far is not scaled: the scored parts out of their own points.
    expect(r.soFar).toBe(5.5)
    expect(r.soFarOutOf).toBe(10)
  })

  it('scales the sum of the rounded parts, rounding once more at the end', () => {
    // Attendance 1/3 of 5 = 1.67; participation 5; assignments not applicable: 6.67 x 3 = 20.01.
    const r = computeCa(DEFAULT_SETTINGS, {
      ...EMPTY,
      attendance: { present: 1, partial: 0, absent: 2 },
      participationNet: 5,
      classStarted: ALL_STARTED,
    })
    expect(r.components.map((c) => c.score)).toEqual([1.67, null, 5])
    expect(r.final).toBe(20.01)
  })

  it('scales over a not-applicable part while a not-started part still counts 0', () => {
    // Attendance not applicable (no counted session since joining), assignments not started.
    const r = computeCa(DEFAULT_SETTINGS, {
      ...EMPTY,
      participationNet: 5,
      classStarted: { attendance: true, assignments: false, participation: true, tests: false },
    })
    expect(r.components.map((c) => c.status)).toEqual(['not_applicable', 'not_started', 'scored'])
    // 5 x 30 / (30 - 5) = 6
    expect(r.final).toBe(6)
    expect(r.scaled).toBe(true)
  })

  it('gives 0, scaled and not assessed, when no part applies to the student', () => {
    const settings = { ...DEFAULT_SETTINGS, total: 25, participationPoints: 0 }
    const r = computeCa(settings, { ...EMPTY, classStarted: ALL_STARTED })
    expect(r.components.map((c) => c.status)).toEqual(['not_applicable', 'not_applicable'])
    expect(r.final).toBe(0)
    expect(r.scaled).toBe(true)
    expect(r.notAssessed).toBe(true)
    expect(r.soFar).toBe(0)
    expect(r.soFarOutOf).toBe(0)
  })

  it('parts add up: the final is the sum of the rounded parts', () => {
    // Each third of 5 is 1.67, so the CA is 1.67 x 3 = 5.01.
    const thirds = computeCa(
      { total: 15, attendancePoints: 5, assignmentPoints: 5, participationPoints: 5, testPoints: 0, participationTarget: 3, testsBestOf: null },
      {
        attendance: { present: 1, partial: 0, absent: 2 },
        assignments: [{ weight: 1, mark: 1, maxMark: 3 }],
        participationNet: 1,
        tests: [],
        classStarted: ALL_STARTED,
      },
    )
    expect(thirds.components.map((c) => c.score)).toEqual([1.67, 1.67, 1.67])
    expect(thirds.soFar).toBe(5.01)
    expect(thirds.final).toBe(5.01)
    expect(thirds.scaled).toBe(false)
    // Each half point is 0.505, shown 0.51: the CA is 0.51 x 3 = 1.53.
    const halves = computeCa(
      { total: 3.03, attendancePoints: 1.01, assignmentPoints: 1.01, participationPoints: 1.01, testPoints: 0, participationTarget: 2, testsBestOf: null },
      {
        attendance: { present: 1, partial: 0, absent: 1 },
        assignments: [{ weight: 1, mark: 1, maxMark: 2 }],
        participationNet: 1,
        tests: [],
        classStarted: ALL_STARTED,
      },
    )
    expect(halves.components.map((c) => c.score)).toEqual([0.51, 0.51, 0.51])
    expect(halves.soFar).toBe(1.53)
    expect(halves.final).toBe(1.53)
  })

  it('rounds .005 cases up despite float representation', () => {
    const settings = { ...DEFAULT_SETTINGS, attendancePoints: 1.005, assignmentPoints: 18.995, participationPoints: 5 }
    const r = computeCa(settings, {
      ...EMPTY,
      attendance: { present: 1, partial: 0, absent: 0 },
      classStarted: { ...EMPTY.classStarted, attendance: true },
    })
    expect(part(r, 'attendance').score).toBe(1.01)
  })
})

describe('computeCa: tests', () => {
  // 10 points for tests: 5 + 10 + 5 + 10 = 30.
  const s: CaSettings = { ...DEFAULT_SETTINGS, assignmentPoints: 10, testPoints: 10 }
  const t = (weight: number, ratio: number) => ({ weight, ratio })
  const testsStarted = { ...EMPTY, classStarted: { ...EMPTY.classStarted, tests: true } }
  const testsScore = (settings: CaSettings, tests: CaInput['tests']) =>
    computeCa(settings, { ...testsStarted, tests }).components.find((c) => c.key === 'tests')?.score

  it('lists tests after the other parts when they have points', () => {
    expect(computeCa(s, EMPTY).components.map((c) => c.key)).toEqual(['attendance', 'assignments', 'participation', 'tests'])
    expect(part(computeCa(s, EMPTY), 'tests')).toEqual({ key: 'tests', points: 10, ratio: null, score: null, status: 'not_started' })
  })

  it('combines tests by weight, keeping the best N when the course says so', () => {
    expect(testsScore(s, [])).toBeNull()
    // Best 2 of 3 with only one released: that one test's ratio.
    expect(testsScore({ ...s, testsBestOf: 2 }, [t(1, 0.5)])).toBe(5)
    // Keeps 0.9 and 0.6: (0.9 + 1.2) / 3 = 0.7.
    expect(testsScore({ ...s, testsBestOf: 2 }, [t(1, 0.9), t(1, 0.4), t(2, 0.6)])).toBe(7)
    // All: (0.9 + 0.4 + 1.2) / 4 = 0.625.
    expect(testsScore({ ...s, testsBestOf: null }, [t(1, 0.9), t(1, 0.4), t(2, 0.6)])).toBe(6.25)
    // Best N larger than the number of tests: all of them.
    expect(testsScore({ ...s, testsBestOf: 5 }, [t(1, 0.9), t(1, 0.4), t(2, 0.6)])).toBe(6.25)
  })

  it('omits tests worth 0 points', () => {
    expect(testsScore({ ...s, assignmentPoints: 20, testPoints: 0 }, [t(1, 1)])).toBeUndefined()
  })

  it('a student who never joined scores 0 on the test (ratio 0), not a missing part', () => {
    const r = computeCa({ ...s, testsBestOf: 2 }, { ...testsStarted, tests: [t(1, 0)] })
    expect(part(r, 'tests')).toEqual({ key: 'tests', points: 10, ratio: 0, score: 0, status: 'scored' })
    expect(r.scaled).toBe(false)
  })

  it('tests started for the class but none counting for the student are not applicable, and scale the rest', () => {
    const r = computeCa(s, { ...EMPTY, participationNet: 5, classStarted: { ...EMPTY.classStarted, participation: true, tests: true } })
    expect(part(r, 'tests')).toMatchObject({ ratio: null, score: null, status: 'not_applicable' })
    // Participation 5, assignments and attendance not started (0): 5 x 30 / (30 - 10) = 7.5.
    expect(r.final).toBe(7.5)
    expect(r.scaled).toBe(true)
  })

  it('adds the rounded tests part to the others', () => {
    // Tests: (1/3) of 10 = 3.33; participation 5/5.
    const r = computeCa(s, {
      ...EMPTY,
      participationNet: 5,
      tests: [t(1, 1 / 3)],
      classStarted: { ...EMPTY.classStarted, participation: true, tests: true },
    })
    expect(part(r, 'tests').score).toBe(3.33)
    expect(r.final).toBe(8.33)
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
  const result = (soFar: number, soFarOutOf: number) => ({
    components: [],
    soFar,
    soFarOutOf,
    final: soFar,
    total: 30,
    scaled: false,
    notAssessed: false,
  })

  it('flags CA so far below half of its points', () => {
    expect(isSlipping(result(4.999, 10), null, 0)).toBe(true)
    expect(isSlipping(result(5, 10), null, 0)).toBe(false)
  })

  it('flags on CA so far only once its parts are worth at least a quarter of the total', () => {
    // A quarter of 30 is 7.5.
    expect(isSlipping(result(0, 7.49), null, 0)).toBe(false)
    expect(isSlipping(result(0, 7.5), null, 0)).toBe(true)
    expect(isSlipping(result(3.74, 7.5), null, 0)).toBe(true)
    expect(isSlipping(result(3.75, 7.5), null, 0)).toBe(false)
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
