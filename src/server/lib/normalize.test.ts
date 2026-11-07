import { describe, expect, it } from 'vitest'
import { normalizeKey } from './normalize'

describe('normalizeKey', () => {
  it('collapses case and whitespace', () =>
    expect(normalizeKey('  University of   Buea ')).toBe('university of buea'))

  it('treats tabs and newlines as whitespace', () =>
    expect(normalizeKey('Buea\t\n Town')).toBe('buea town'))

  it('returns an empty string for blank input', () => expect(normalizeKey('   ')).toBe(''))
})
