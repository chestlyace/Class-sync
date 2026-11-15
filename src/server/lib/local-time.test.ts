import { describe, expect, it } from 'vitest'
import {
  addDays,
  instantAt,
  isoWeekday,
  localDateOf,
  parseLocalDateTime,
  toLocalDateTimeInput,
  weekStartOf,
} from './local-time'

describe('parseLocalDateTime', () => {
  it('converts a wall time in a DST-free zone', () => {
    expect(parseLocalDateTime('2026-11-12T08:00', 'Africa/Douala')?.toISOString()).toBe('2026-11-12T07:00:00.000Z')
  })
  it('uses the zone offset in force on that date (DST zone)', () => {
    expect(parseLocalDateTime('2026-07-01T08:00', 'Europe/Paris')?.toISOString()).toBe('2026-07-01T06:00:00.000Z')
    expect(parseLocalDateTime('2026-01-15T08:00', 'Europe/Paris')?.toISOString()).toBe('2026-01-15T07:00:00.000Z')
    expect(parseLocalDateTime('2026-03-30T08:00', 'Europe/Paris')?.toISOString()).toBe('2026-03-30T06:00:00.000Z')
    expect(parseLocalDateTime('2026-03-20T08:00', 'Europe/Paris')?.toISOString()).toBe('2026-03-20T07:00:00.000Z')
  })
  it('handles zones west of UTC and across midnight', () => {
    expect(parseLocalDateTime('2026-07-01T23:30', 'America/New_York')?.toISOString()).toBe('2026-07-02T03:30:00.000Z')
  })
  it('resolves DST gaps and overlaps deterministically', () => {
    // 02:30 does not exist on 2026-03-29 in Paris: lands at 03:30 CEST.
    expect(parseLocalDateTime('2026-03-29T02:30', 'Europe/Paris')?.toISOString()).toBe('2026-03-29T01:30:00.000Z')
    // 02:30 happens twice on 2026-10-25: the second (CET) one is used.
    expect(parseLocalDateTime('2026-10-25T02:30', 'Europe/Paris')?.toISOString()).toBe('2026-10-25T01:30:00.000Z')
  })
  it('accepts seconds', () => {
    expect(parseLocalDateTime('2026-11-12T08:00:30', 'Africa/Douala')?.toISOString()).toBe('2026-11-12T07:00:30.000Z')
  })
  it('returns null for garbage, impossible dates and bad zones', () => {
    expect(parseLocalDateTime('not a date', 'Africa/Douala')).toBeNull()
    expect(parseLocalDateTime('', 'Africa/Douala')).toBeNull()
    expect(parseLocalDateTime('2026-02-30T08:00', 'Africa/Douala')).toBeNull()
    expect(parseLocalDateTime('2026-11-12T25:00', 'Africa/Douala')).toBeNull()
    expect(parseLocalDateTime('2026-11-12', 'Africa/Douala')).toBeNull()
    expect(parseLocalDateTime('2026-11-12T08:00', 'Not/AZone')).toBeNull()
  })
})

describe('toLocalDateTimeInput', () => {
  it('formats an instant as a wall time in the zone', () => {
    expect(toLocalDateTimeInput(new Date('2026-11-12T07:00:00Z'), 'Africa/Douala')).toBe('2026-11-12T08:00')
    expect(toLocalDateTimeInput(new Date('2026-07-01T06:00:00Z'), 'Europe/Paris')).toBe('2026-07-01T08:00')
    expect(toLocalDateTimeInput(new Date('2026-07-01T22:00:00Z'), 'Europe/Paris')).toBe('2026-07-02T00:00')
  })
  it('round-trips', () => {
    const d = parseLocalDateTime('2026-10-25T02:30', 'Africa/Douala')!
    expect(toLocalDateTimeInput(d, 'Africa/Douala')).toBe('2026-10-25T02:30')
  })
})

describe('date helpers', () => {
  const tz = 'Africa/Douala'
  it('localDateOf reads the local date of an instant', () => {
    expect(localDateOf(new Date('2026-11-16T23:30:00Z'), tz)).toBe('2026-11-17')
    expect(localDateOf(new Date('2026-11-16T22:30:00Z'), tz)).toBe('2026-11-16')
  })
  it('instantAt converts minutes from local midnight', () => {
    expect(instantAt('2026-11-16', 480, tz).toISOString()).toBe('2026-11-16T07:00:00.000Z')
    expect(instantAt('2026-11-16', 0, tz).toISOString()).toBe('2026-11-15T23:00:00.000Z')
  })
  it('instantAt treats minute 1440 as the next midnight', () => {
    expect(instantAt('2026-11-16', 1440, tz).getTime()).toBe(instantAt('2026-11-17', 0, tz).getTime())
    expect(instantAt('2026-12-31', 1440, tz).getTime()).toBe(instantAt('2027-01-01', 0, tz).getTime())
  })
  it('addDays crosses month and year ends, forwards and back', () => {
    expect(addDays('2026-11-30', 1)).toBe('2026-12-01')
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01')
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28')
    expect(addDays('2026-11-16', 7)).toBe('2026-11-23')
  })
  it('isoWeekday is 1 for Monday and 7 for Sunday', () => {
    expect(isoWeekday('2026-11-16')).toBe(1)
    expect(isoWeekday('2026-11-22')).toBe(7)
  })
  it('weekStartOf returns that week\'s Monday', () => {
    expect(weekStartOf('2026-11-19')).toBe('2026-11-16')
    expect(weekStartOf('2026-11-16')).toBe('2026-11-16')
    expect(weekStartOf('2026-11-22')).toBe('2026-11-16')
  })
})
