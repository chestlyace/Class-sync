import { describe, expect, it } from 'vitest'
import { safeNextPath } from './next-path'

describe('safeNextPath', () => {
  it('keeps a same-site path', () => {
    expect(safeNextPath('/t/8F3KQ2')).toBe('/t/8F3KQ2')
    expect(safeNextPath('/courses/abc?tab=1')).toBe('/courses/abc?tab=1')
  })

  it('refuses anything that could leave the site, and non-strings', () => {
    for (const value of ['//evil.com', 'https://evil.com', '/\\evil', '', 'evil.com', ' /t/X', 42, null, undefined, ['/t/X']]) {
      expect(safeNextPath(value), String(value)).toBeNull()
    }
  })

  it('refuses encoded or blank-padded slashes and script URLs', () => {
    // Browsers drop tabs and newlines from URLs ('/\t/evil' is '//evil'); one more decoding of
    // '/%2Fevil' is '//evil' too.
    for (const value of ['/%2Fevil', '/%2fevil', '/%5Cevil', '/\t/evil', 'javascript:alert(1)']) {
      expect(safeNextPath(value), value).toBeNull()
    }
    expect(safeNextPath('/t/A%2FB')).toBe('/t/A%2FB')
  })

  it('refuses control characters and overly long values', () => {
    expect(safeNextPath('/t/A\nB')).toBeNull()
    expect(safeNextPath(`/${'a'.repeat(600)}`)).toBeNull()
  })
})
