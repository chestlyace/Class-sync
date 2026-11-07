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
})
