import { describe, expect, it } from 'vitest'
import en from '../../messages/en.json'
import { authErrorKey } from './auth-errors'

function lookup(key: string): unknown {
  return key.split('.').reduce<unknown>((o, k) => (o as Record<string, unknown> | undefined)?.[k], en)
}

describe('authErrorKey', () => {
  it('maps known Better Auth codes to existing message keys', () => {
    for (const code of ['INVALID_EMAIL_OR_PASSWORD', 'USER_ALREADY_EXISTS', 'PASSWORD_TOO_SHORT', 'EMAIL_NOT_VERIFIED', 'VALIDATION']) {
      expect(typeof lookup(authErrorKey(code)), code).toBe('string')
    }
  })

  it('falls back to the generic error', () => {
    expect(authErrorKey('SOMETHING_NEW')).toBe('common.genericError')
    expect(authErrorKey(undefined)).toBe('common.genericError')
  })
})
