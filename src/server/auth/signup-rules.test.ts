import { describe, expect, it } from 'vitest'
import { assertValidSignup, assertValidUserUpdate, cleanName } from './signup-rules'

const nameError = expect.objectContaining({ code: 'VALIDATION', details: { fields: ['name'] } })

describe('cleanName', () => {
  it('trims and collapses spaces', () => {
    expect(cleanName('  Wirndzerem   Bradley\tFanka ')).toBe('Wirndzerem Bradley Fanka')
  })

  it('keeps ordinary names with accents, apostrophes, hyphens and dots', () => {
    for (const name of ["Ngo'o Marie-Claire", 'Dr. Élodie N. Mbarga', 'Malibak Leslie', 'X']) {
      expect(cleanName(name)).toBe(name)
    }
  })

  it('refuses tags, links and email addresses', () => {
    for (const name of [
      "RSD</p><h1>HEADLINE</h1><p><a href='https://example.com/LURE'>CLICK_ME</a>",
      '<b>HTMLBOLD</b>',
      'BUY NOW https://example.com/LURE',
      'visit www.example.com today',
      'mail me at someone@example.com',
      'back\\slash',
    ]) {
      expect(() => cleanName(name)).toThrow(nameError)
    }
  })

  it('refuses empty, over-long and control-character names', () => {
    expect(() => cleanName('   ')).toThrow(nameError)
    expect(() => cleanName('A'.repeat(81))).toThrow(nameError)
    expect(cleanName('A'.repeat(80))).toBe('A'.repeat(80))
    expect(() => cleanName('Ada\u0007Lovelace')).toThrow(nameError)
    expect(() => cleanName(42)).toThrow(nameError)
  })
})

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

describe('validUserUpdate (name)', () => {
  it('cleans a new name and refuses a bad one', () => {
    expect(assertValidUserUpdate({ name: '  Ada   Lovelace ' })).toEqual({ name: 'Ada Lovelace' })
    expect(() => assertValidUserUpdate({ name: 'BUY NOW https://example.com/LURE' })).toThrow(nameError)
  })

  it('leaves an update without a name as it is', () => {
    expect(assertValidUserUpdate({ locale: 'fr' })).toEqual({ locale: 'fr' })
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
