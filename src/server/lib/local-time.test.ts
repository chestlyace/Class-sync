import { describe, expect, it } from 'vitest'
import { parseLocalDateTime, toLocalDateTimeInput } from './local-time'

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
