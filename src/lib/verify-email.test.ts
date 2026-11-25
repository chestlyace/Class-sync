import { describe, expect, it } from 'vitest'
import { emailNotSent, verifyEmailHref } from './verify-email'

describe('verifyEmailHref', () => {
  it('carries the address and where to go next', () => {
    expect(verifyEmailHref('a@b.co', { next: '/join?code=X' })).toBe('/verify-email?email=a%40b.co&next=%2Fjoin%3Fcode%3DX')
  })

  it('marks an email that could not be sent with the fixed flag only', () => {
    expect(verifyEmailHref('a@b.co', { sent: false })).toBe('/verify-email?email=a%40b.co&sent=0')
    expect(verifyEmailHref('a@b.co', { sent: true })).toBe('/verify-email?email=a%40b.co')
  })
})

describe('emailNotSent', () => {
  it('accepts only the exact flag', () => {
    expect(emailNotSent('0')).toBe(true)
    for (const value of [undefined, '', '1', 'false', 'Could not send', ['0']]) expect(emailNotSent(value)).toBe(false)
  })
})
