import { describe, expect, it } from 'vitest'
import { MEETING_URL_MAX, parseMeetingUrl } from './meeting-url'

const meet = 'https://meet.google.com/abc-defg-hij'

describe('parseMeetingUrl', () => {
  it('treats a blank value as an in-person class', () => {
    expect(parseMeetingUrl('')).toBeNull()
    expect(parseMeetingUrl('   ')).toBeNull()
    expect(parseMeetingUrl(null)).toBeNull()
    expect(parseMeetingUrl(undefined)).toBeNull()
  })

  it('accepts a trimmed Google Meet link of at most 2048 characters', () => {
    expect(parseMeetingUrl(`  ${meet}  `)).toBe(meet)
    expect(parseMeetingUrl(`https://meet.google.com/${'a'.repeat(MEETING_URL_MAX - 'https://meet.google.com/'.length)}`)).toHaveLength(
      MEETING_URL_MAX,
    )
  })

  it('stores the URL as the parser normalised it, not as pasted', () => {
    expect(parseMeetingUrl('https://meet.google.com/abc\ndef-ghij')).toBe('https://meet.google.com/abcdef-ghij')
  })

  it('refuses other hosts, protocols and crafted URLs', () => {
    for (const bad of [
      'http://meet.google.com/abc-defg-hij',
      'https://zoom.us/abc',
      'https://meet.google.com.evil.test/abc',
      'https://user:pass@meet.google.com/abc',
      'https://meet.google.com:444/abc',
      'javascript:alert(1)',
      'meet.google.com/abc-defg-hij',
      'https://meet.google.com/',
    ]) {
      expect(() => parseMeetingUrl(bad)).toThrowError(expect.objectContaining({ code: 'VALIDATION' }))
    }
  })

  it('refuses a link longer than 2048 characters', () => {
    expect(() => parseMeetingUrl(`https://meet.google.com/${'a'.repeat(MEETING_URL_MAX)}`)).toThrowError(
      expect.objectContaining({ code: 'VALIDATION' }),
    )
  })
})
