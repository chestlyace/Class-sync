import { describe, expect, it } from 'vitest'
import { maskPhone, toE164 } from './phone'

describe('toE164', () => {
  it('adds the Cameroon prefix to a bare 9-digit mobile number', () => {
    expect(toE164('677123456')).toBe('+237677123456')
  })

  it('ignores spaces, dashes, dots and brackets', () => {
    expect(toE164('+237 677 12 34 56')).toBe('+237677123456')
    expect(toE164('+237-677.12.34.56')).toBe('+237677123456')
    expect(toE164('(+237) [677] 123456')).toBe('+237677123456')
  })

  it('reads 00 as +', () => {
    expect(toE164('00237677123456')).toBe('+237677123456')
  })

  it('keeps a number that is already in E.164 form', () => {
    expect(toE164('+237677123456')).toBe('+237677123456')
    expect(toE164('+33612345678')).toBe('+33612345678')
  })

  it('refuses text that is not a phone number', () => {
    expect(toE164('12')).toBeNull()
    expect(toE164('abc')).toBeNull()
    expect(toE164('')).toBeNull()
    expect(toE164('+1234567890123456')).toBeNull()
  })
})

describe('maskPhone', () => {
  it('keeps only the last two digits', () => {
    expect(maskPhone('+237612345412')).toBe('+••••••••••12')
    expect(maskPhone('+33612345678')).toBe('+•••••••••78')
  })

  it('never shows more than two digits, whatever it is given', () => {
    expect(maskPhone('+237 6')).toBe('+••76')
    expect(maskPhone('')).toBe('+•')
  })
})
