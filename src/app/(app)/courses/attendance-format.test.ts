import { describe, expect, it } from 'vitest'
import { formatSessionDate } from './attendance-format'

describe('formatSessionDate', () => {
  const date = new Date('2026-11-09T07:30:00Z')

  it('shows the weekday and time in the given time zone, in French', () => {
    const text = formatSessionDate(date, 'fr', 'Africa/Douala')
    expect(text).toContain('08:30')
    expect(text).toContain('lundi')
  })

  it('uses English weekday names for en', () => {
    expect(formatSessionDate(date, 'en', 'Africa/Douala')).toContain('Monday')
  })

  it('shifts the date with the time zone', () => {
    // 23:30 UTC on Sunday is already Monday in Douala (UTC+1).
    expect(formatSessionDate(new Date('2026-11-08T23:30:00Z'), 'en', 'Africa/Douala')).toContain('Monday')
    expect(formatSessionDate(new Date('2026-11-08T23:30:00Z'), 'en', 'UTC')).toContain('Sunday')
  })

  it("'time' is the clock time alone, 24-hour in both languages", () => {
    const evening = new Date('2026-11-09T19:05:00Z') // 20:05 in Douala
    expect(formatSessionDate(evening, 'en', 'Africa/Douala', 'time')).toBe('20:05')
    expect(formatSessionDate(evening, 'fr', 'Africa/Douala', 'time')).toBe('20:05')
  })
})
