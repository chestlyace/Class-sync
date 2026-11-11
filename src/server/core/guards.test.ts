import { afterEach, describe, expect, it } from 'vitest'
import { config, setConfigForTests } from './config'
import { isVerificationPending, requireAdmin, requireRole, requireVerified } from './guards'
import type { Ctx, SessionUser } from './context'
import type { Db } from '../db'
import { AppError } from './errors'

const baseUser: SessionUser = {
  id: 'u1',
  name: 'Test User',
  email: 'u1@example.com',
  role: 'lecturer',
  locale: 'en',
  emailVerified: true,
}

function ctx(overrides: Partial<SessionUser> = {}): Ctx {
  return { db: {} as Db, user: { ...baseUser, ...overrides } }
}

describe('guards', () => {
  const original = config.requireEmailVerification
  afterEach(() => setConfigForTests({ requireEmailVerification: original }))

  it('requireVerified throws EMAIL_UNVERIFIED for unverified user when verification is required', () => {
    setConfigForTests({ requireEmailVerification: true })
    expect(() => requireVerified(ctx({ emailVerified: false }))).toThrow(
      expect.objectContaining({ code: 'EMAIL_UNVERIFIED' }),
    )
  })

  it('requireVerified allows verified user when verification is required', () => {
    setConfigForTests({ requireEmailVerification: true })
    expect(() => requireVerified(ctx())).not.toThrow()
  })

  it('requireVerified allows unverified user when verification is switched off', () => {
    setConfigForTests({ requireEmailVerification: false })
    expect(() => requireVerified(ctx({ emailVerified: false }))).not.toThrow()
  })

  it('isVerificationPending is true only for an unverified user while verification is required', () => {
    setConfigForTests({ requireEmailVerification: true })
    expect(isVerificationPending(ctx({ emailVerified: false }).user)).toBe(true)
    expect(isVerificationPending(ctx().user)).toBe(false)
    setConfigForTests({ requireEmailVerification: false })
    expect(isVerificationPending(ctx({ emailVerified: false }).user)).toBe(false)
  })

  it('requireRole throws FORBIDDEN when a student calls a lecturer action', () => {
    expect(() => requireRole(ctx({ role: 'student' }), 'lecturer')).toThrow(
      expect.objectContaining({ code: 'FORBIDDEN' }),
    )
  })

  it('requireRole allows the matching role', () => {
    expect(() => requireRole(ctx({ role: 'lecturer' }), 'lecturer')).not.toThrow()
  })

  it('requireRole also enforces verification', () => {
    setConfigForTests({ requireEmailVerification: true })
    expect(() => requireRole(ctx({ emailVerified: false }), 'lecturer')).toThrow(
      expect.objectContaining({ code: 'EMAIL_UNVERIFIED' }),
    )
  })

  describe('requireAdmin', () => {
    const adminEnv = { ADMIN_EMAILS: 'u1@example.com' }

    function thrownBy(fn: () => void): unknown {
      try {
        fn()
      } catch (error) {
        return error
      }
      return undefined
    }

    it('throws NOT_FOUND for a user who is not an admin', () => {
      const error = thrownBy(() => requireAdmin(ctx({ email: 'other@example.com' }), adminEnv))
      expect(error).toBeInstanceOf(AppError)
      expect((error as AppError).code).toBe('NOT_FOUND')
    })

    it('throws NOT_FOUND for an admin email that is not verified', () => {
      const error = thrownBy(() => requireAdmin(ctx({ emailVerified: false }), adminEnv))
      expect(error).toBeInstanceOf(AppError)
      expect((error as AppError).code).toBe('NOT_FOUND')
    })

    it('does not throw for a verified admin', () => {
      expect(() => requireAdmin(ctx(), adminEnv)).not.toThrow()
    })
  })
})
