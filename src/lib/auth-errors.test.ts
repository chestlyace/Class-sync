import { describe, expect, it } from 'vitest'
import en from '../../messages/en.json'
import fr from '../../messages/fr.json'
import { authErrorKey, googleErrorKey } from './auth-errors'

function lookup(key: string, messages: unknown = en): unknown {
  return key.split('.').reduce<unknown>((o, k) => (o as Record<string, unknown> | undefined)?.[k], messages)
}

describe('authErrorKey', () => {
  it('maps known Better Auth codes to existing message keys', () => {
    for (const code of ['INVALID_EMAIL_OR_PASSWORD', 'USER_ALREADY_EXISTS', 'INVALID_PHONE_NUMBER_OR_PASSWORD', 'PASSWORD_TOO_SHORT', 'VALIDATION']) {
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

  it('maps EMAIL_NOT_VERIFIED_FOR_LINK to "confirm your email first", in both languages', () => {
    const key = authErrorKey('EMAIL_NOT_VERIFIED_FOR_LINK')
    expect(key).toBe('settings.signInMethods.confirmEmailFirst')
    expect(typeof lookup(key)).toBe('string')
    expect(typeof lookup(key, fr)).toBe('string')
  })

  it('maps ACCOUNT_SUSPENDED to the suspended-account message, in both languages', () => {
    expect(authErrorKey('ACCOUNT_SUSPENDED')).toBe('auth.errors.accountSuspended')
    expect(lookup('auth.errors.accountSuspended')).toBe('This account is suspended.')
    expect(lookup('auth.errors.accountSuspended', fr)).toBe('Ce compte est suspendu.')
    expect(lookup('auth.errors.accountSuspendedContact')).toBe('Contact {email}.')
    expect(lookup('auth.errors.accountSuspendedContact', fr)).toBe('Contactez {email}.')
  })

  it('maps INVALID_NAME to a message saying what a name may contain, in both languages', () => {
    expect(authErrorKey('INVALID_NAME')).toBe('auth.errors.invalidName')
    expect(typeof lookup('auth.errors.invalidName')).toBe('string')
    expect(typeof lookup('auth.errors.invalidName', fr)).toBe('string')
  })

  it('falls back to the generic error', () => {
    expect(authErrorKey('SOMETHING_NEW')).toBe('common.genericError')
    expect(authErrorKey(undefined)).toBe('common.genericError')
  })
})

describe('googleErrorKey', () => {
  it('maps the codes a Google round trip comes back with to existing messages in both languages', () => {
    for (const code of ['signup_disabled', 'account_not_linked', 'account_already_linked_to_different_user', 'ACCOUNT_SUSPENDED', 'access_denied', 'invalid_code']) {
      const key = googleErrorKey(code)!
      expect(typeof lookup(key), code).toBe('string')
      expect(typeof lookup(key, fr), code).toBe('string')
    }
    expect(googleErrorKey('signup_disabled')).toBe('auth.google.noAccount')
    expect(googleErrorKey('invalid_code')).toBe('auth.google.failed')
  })

  it('is null without an error', () => {
    expect(googleErrorKey(undefined)).toBeNull()
    expect(googleErrorKey('')).toBeNull()
    expect(googleErrorKey(['a', 'b'])).toBeNull()
  })
})
