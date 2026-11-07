import { describe, expect, it } from 'vitest'
import { assertValidSignup, assertValidUserUpdate } from './signup-rules'

describe('assertValidSignup', () => {
  it('rejects roles other than lecturer and student', () => {
    expect(() => assertValidSignup({ role: 'admin', locale: 'en' })).toThrow(
      expect.objectContaining({ code: 'VALIDATION' }),
    )
    expect(() => assertValidSignup({ role: undefined, locale: 'en' })).toThrow(
      expect.objectContaining({ code: 'VALIDATION' }),
    )
  })

  it('rejects unsupported locales', () => {
    expect(() => assertValidSignup({ role: 'student', locale: 'de' })).toThrow(
      expect.objectContaining({ code: 'VALIDATION' }),
    )
  })

  it('defaults a missing locale to en', () => {
    expect(assertValidSignup({ role: 'student', locale: undefined })).toEqual({
      role: 'student',
      locale: 'en',
    })
  })

  it('accepts valid input', () => {
    expect(assertValidSignup({ role: 'lecturer', locale: 'fr' })).toEqual({
      role: 'lecturer',
      locale: 'fr',
    })
  })
})

describe('assertValidUserUpdate', () => {
  it('rejects any update containing role', () => {
    expect(() => assertValidUserUpdate({ role: 'lecturer' })).toThrow(
      expect.objectContaining({ code: 'VALIDATION' }),
    )
    expect(() => assertValidUserUpdate({ role: undefined })).toThrow(
      expect.objectContaining({ code: 'VALIDATION' }),
    )
  })

  it('validates locale', () => {
    expect(() => assertValidUserUpdate({ locale: 'xx' })).toThrow(
      expect.objectContaining({ code: 'VALIDATION' }),
    )
    expect(() => assertValidUserUpdate({ locale: 'fr' })).not.toThrow()
  })

  it('allows unrelated updates', () => {
    expect(() => assertValidUserUpdate({ name: 'Ada', emailVerified: true })).not.toThrow()
  })
})
