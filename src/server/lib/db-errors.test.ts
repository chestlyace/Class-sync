import { describe, expect, it } from 'vitest'
import { isUniqueViolation } from './db-errors'

describe('isUniqueViolation', () => {
  it('detects a 23505 code on the error itself', () => {
    expect(isUniqueViolation(Object.assign(new Error('dup'), { code: '23505' }))).toBe(true)
  })

  it('detects a 23505 code on the cause (Drizzle wraps driver errors)', () => {
    const cause = Object.assign(new Error('dup'), { code: '23505' })
    expect(isUniqueViolation(new Error('Failed query', { cause }))).toBe(true)
  })

  it('ignores other Postgres errors and non-errors', () => {
    expect(isUniqueViolation(Object.assign(new Error('x'), { code: '23503' }))).toBe(false)
    expect(isUniqueViolation(new Error('plain'))).toBe(false)
    expect(isUniqueViolation(null)).toBe(false)
    expect(isUniqueViolation('23505')).toBe(false)
  })

  it('narrows by constraint name when one is given', () => {
    const err = Object.assign(new Error('dup'), { code: '23505', constraint: 'a_unique' })
    expect(isUniqueViolation(err, 'a_unique')).toBe(true)
    expect(isUniqueViolation(err, 'b_unique')).toBe(false)
  })
})
