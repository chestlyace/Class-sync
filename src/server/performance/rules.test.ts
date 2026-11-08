import { describe, expect, it } from 'vitest'
import { DEFAULT_SETTINGS, SLIP_ATTENDANCE, SLIP_MIN_SESSIONS, SLIP_RATIO, validateSettings } from './rules'

describe('constants', () => {
  it('has the agreed defaults and slip thresholds', () => {
    expect(DEFAULT_SETTINGS).toEqual({
      total: 30,
      attendancePoints: 5,
      assignmentPoints: 20,
      participationPoints: 5,
      testPoints: 0,
      participationTarget: 5,
      testsBestOf: null,
    })
    expect(SLIP_RATIO).toBe(0.5)
    expect(SLIP_ATTENDANCE).toBe(0.75)
    expect(SLIP_MIN_SESSIONS).toBe(3)
  })
})

describe('validateSettings', () => {
  it('accepts the defaults', () => {
    expect(validateSettings(DEFAULT_SETTINGS)).toEqual(DEFAULT_SETTINGS)
  })

  it('accepts decimals up to 2 places that add up exactly', () => {
    const input = { ...DEFAULT_SETTINGS, total: 20.3, attendancePoints: 5.1, assignmentPoints: 10.1, participationPoints: 5.1 }
    expect(validateSettings(input)).toEqual(input)
  })

  it('returns only the known fields', () => {
    expect(validateSettings({ ...DEFAULT_SETTINGS, extra: 1 })).toEqual(DEFAULT_SETTINGS)
  })

  it('refuses parts that do not add up to the total', () => {
    expect(validateSettings({ ...DEFAULT_SETTINGS, attendancePoints: 10, assignmentPoints: 10, participationPoints: 5 })).toEqual({
      error: 'sum',
    })
  })

  it('counts reserved test points in the sum', () => {
    expect(validateSettings({ ...DEFAULT_SETTINGS, testPoints: 1 })).toEqual({ error: 'sum' })
    expect(validateSettings({ ...DEFAULT_SETTINGS, assignmentPoints: 19, testPoints: 1 })).toEqual({
      ...DEFAULT_SETTINGS,
      assignmentPoints: 19,
      testPoints: 1,
    })
  })

  it('accepts test points that add up (10 + 10 + 5 + 5 for 30)', () => {
    const input = { ...DEFAULT_SETTINGS, attendancePoints: 10, assignmentPoints: 10, participationPoints: 5, testPoints: 5 }
    expect(validateSettings(input)).toEqual(input)
  })

  it('accepts best-of as empty (all tests) or a whole number from 1 to 50', () => {
    for (const testsBestOf of [null, 1, 3, 50]) {
      expect(validateSettings({ ...DEFAULT_SETTINGS, testsBestOf })).toEqual({ ...DEFAULT_SETTINGS, testsBestOf })
    }
    // Left out entirely: all tests count.
    const withoutBestOf: Record<string, unknown> = { ...DEFAULT_SETTINGS }
    delete withoutBestOf.testsBestOf
    expect(validateSettings(withoutBestOf)).toEqual(DEFAULT_SETTINGS)
  })

  it('refuses a best-of that is not a whole number from 1 to 50', () => {
    for (const testsBestOf of [0, 2.5, -1, 51, NaN, Infinity]) {
      expect(validateSettings({ ...DEFAULT_SETTINGS, testsBestOf }), String(testsBestOf)).toEqual({ error: 'range' })
    }
    expect(validateSettings({ ...DEFAULT_SETTINGS, testsBestOf: '3' })).toEqual({ error: 'shape' })
  })

  it('refuses more than 2 decimals', () => {
    expect(validateSettings({ ...DEFAULT_SETTINGS, attendancePoints: 5.005, assignmentPoints: 19.995 })).toEqual({
      error: 'decimals',
    })
    expect(validateSettings({ ...DEFAULT_SETTINGS, total: 30.001 })).toEqual({ error: 'decimals' })
  })

  it('refuses negative and out-of-range numbers', () => {
    expect(validateSettings({ ...DEFAULT_SETTINGS, attendancePoints: -5, assignmentPoints: 30 })).toEqual({ error: 'range' })
    expect(validateSettings({ ...DEFAULT_SETTINGS, total: 0, attendancePoints: 0, assignmentPoints: 0, participationPoints: 0 })).toEqual({
      error: 'range',
    })
    expect(validateSettings({ ...DEFAULT_SETTINGS, total: 101 })).toEqual({ error: 'range' })
    expect(validateSettings({ ...DEFAULT_SETTINGS, participationTarget: 0 })).toEqual({ error: 'range' })
    expect(validateSettings({ ...DEFAULT_SETTINGS, participationTarget: 101 })).toEqual({ error: 'range' })
    expect(validateSettings({ ...DEFAULT_SETTINGS, participationTarget: 2.5 })).toEqual({ error: 'range' })
  })

  it('refuses a wrong shape', () => {
    for (const bad of [null, undefined, 'x', 3, [], {}, { ...DEFAULT_SETTINGS, total: '30' }, { ...DEFAULT_SETTINGS, testPoints: undefined }, { ...DEFAULT_SETTINGS, total: NaN }, { ...DEFAULT_SETTINGS, total: Infinity }]) {
      expect(validateSettings(bad), String(JSON.stringify(bad))).toEqual({ error: 'shape' })
    }
  })

  it('returns points normalised to whole cents', () => {
    const sum = validateSettings({ ...DEFAULT_SETTINGS, total: 0.1 + 0.2 + 29.7, attendancePoints: 0.1 + 0.2, assignmentPoints: 29.7, participationPoints: 0 })
    expect(sum).toMatchObject({ attendancePoints: 0.3, assignmentPoints: 29.7, total: 30 })
    const tiny = validateSettings({ ...DEFAULT_SETTINGS, testPoints: 1e-9 })
    expect(tiny).toEqual(DEFAULT_SETTINGS)
    expect(Object.is((tiny as { testPoints: number }).testPoints, 0)).toBe(true)
    expect(validateSettings({ ...DEFAULT_SETTINGS, testPoints: -0 })).toEqual(DEFAULT_SETTINGS)
  })
})
