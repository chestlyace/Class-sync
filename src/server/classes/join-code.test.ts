import { describe, expect, it } from 'vitest'
import { generateJoinCode, JOIN_CODE_ALPHABET, normalizeJoinCode, normalizeMatricule } from './join-code'

describe('join codes', () => {
  it('generateJoinCode returns 6 chars from the alphabet', () => {
    for (let i = 0; i < 1000; i++) expect(generateJoinCode()).toMatch(/^[A-HJ-NP-Z2-9]{6}$/)
  })

  it('the alphabet has no ambiguous characters', () => {
    expect(JOIN_CODE_ALPHABET).toHaveLength(32)
    for (const ch of 'IO01') expect(JOIN_CODE_ALPHABET).not.toContain(ch)
  })

  it('normalizeJoinCode accepts lowercase, spaces and dashes', () =>
    expect(normalizeJoinCode(' ab3-k7x ')).toBe('AB3K7X'))
})

describe('normalizeMatricule', () => {
  it('trims, uppercases and collapses whitespace', () =>
    expect(normalizeMatricule('  ub20  s1234 ')).toBe('UB20 S1234'))

  it('rejects values shorter than 2 or longer than 30 characters', () => {
    expect(() => normalizeMatricule(' a ')).toThrow(expect.objectContaining({ code: 'VALIDATION' }))
    expect(() => normalizeMatricule('x'.repeat(31))).toThrow(expect.objectContaining({ code: 'VALIDATION' }))
    expect(normalizeMatricule('x'.repeat(30))).toHaveLength(30)
  })
})
