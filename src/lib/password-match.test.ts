import { describe, expect, it } from 'vitest'
import { passwordsMatch } from './password-match'

describe('passwordsMatch', () => {
  it('accepts identical passwords', () => {
    expect(passwordsMatch('correct horse battery staple', 'correct horse battery staple')).toBe(true)
  })

  it('accepts canonically equivalent accented characters', () => {
    // Composed "é" and "e" + combining acute accent look identical but are different strings.
    expect(passwordsMatch('café-password', 'cafe\u0301-password')).toBe(true)
  })

  it('rejects genuinely different passwords', () => {
    expect(passwordsMatch('password-one', 'password-two')).toBe(false)
  })
})
