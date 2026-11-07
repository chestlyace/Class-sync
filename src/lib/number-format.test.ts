import { describe, expect, it } from 'vitest'
import { formatDecimal } from './number-format'

describe('formatDecimal', () => {
  it('uses the decimal separator of the language', () => {
    expect(formatDecimal(15.5, 'en')).toBe('15.5')
    expect(formatDecimal(15.5, 'fr')).toBe('15,5')
  })

  it('shows at most two decimals and no trailing zeros', () => {
    expect(formatDecimal(20, 'fr')).toBe('20')
    expect(formatDecimal(0.25, 'en')).toBe('0.25')
  })
})
