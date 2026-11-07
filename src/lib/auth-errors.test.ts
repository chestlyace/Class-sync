import { describe, expect, it } from 'vitest'
import en from '../../messages/en.json'
import fr from '../../messages/fr.json'
import { authErrorKey } from './auth-errors'

function lookup(key: string, messages: unknown = en): unknown {
  return key.split('.').reduce<unknown>((o, k) => (o as Record<string, unknown> | undefined)?.[k], messages)
}

describe('authErrorKey', () => {
  it('maps known Better Auth codes to existing message keys', () => {
    for (const code of ['INVALID_EMAIL_OR_PASSWORD', 'USER_ALREADY_EXISTS', 'PASSWORD_TOO_SHORT', 'EMAIL_NOT_VERIFIED', 'VALIDATION']) {
      expect(typeof lookup(authErrorKey(code)), code).toBe('string')
    }
  })

  it('maps HTTP 429 (rate limited) to a translated "too many attempts" message, whatever the code', () => {
    expect(authErrorKey(undefined, 429)).toBe('auth.errors.tooManyAttempts')
    expect(authErrorKey('INVALID_EMAIL_OR_PASSWORD', 429)).toBe('auth.errors.tooManyAttempts')
    expect(lookup('auth.errors.tooManyAttempts')).toBe('Too many attempts. Wait a moment and try again.')
    expect(lookup('auth.errors.tooManyAttempts', fr)).toBe(
      'Trop de tentatives. Patientez un instant puis réessayez.',
    )
    expect(authErrorKey('INVALID_EMAIL_OR_PASSWORD', 401)).toBe('auth.errors.invalidCredentials')
  })

  it('falls back to the generic error', () => {
    expect(authErrorKey('SOMETHING_NEW')).toBe('common.genericError')
    expect(authErrorKey(undefined)).toBe('common.genericError')
  })
})
