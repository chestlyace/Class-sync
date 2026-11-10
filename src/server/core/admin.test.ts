import { afterEach, describe, expect, it } from 'vitest'
import { setConfigForTests, config } from './config'
import { adminEmails, isAdmin } from './admin'

describe('adminEmails', () => {
  it('parses a comma list, trimming, lower-casing and dropping empty entries', () => {
    expect(adminEmails({ ADMIN_EMAILS: ' A@x.com, ,b@y.org ' })).toEqual(new Set(['a@x.com', 'b@y.org']))
  })

  it('is empty when ADMIN_EMAILS is unset', () => {
    expect(adminEmails({})).toEqual(new Set())
  })
})

describe('isAdmin', () => {
  const original = config.requireEmailVerification
  afterEach(() => setConfigForTests({ requireEmailVerification: original }))

  it('is true for a verified user whose email is listed, ignoring case', () => {
    expect(isAdmin({ email: 'A@X.com', emailVerified: true }, { ADMIN_EMAILS: 'a@x.com' })).toBe(true)
  })

  it('is false for an unverified admin email', () => {
    expect(isAdmin({ email: 'a@x.com', emailVerified: false }, { ADMIN_EMAILS: 'a@x.com' })).toBe(false)
  })

  it('stays false for an unverified admin email even when verification is switched off', () => {
    setConfigForTests({ requireEmailVerification: false })
    expect(isAdmin({ email: 'a@x.com', emailVerified: false }, { ADMIN_EMAILS: 'a@x.com' })).toBe(false)
  })

  it('is false for an email that is not on the list', () => {
    expect(isAdmin({ email: 'someone@x.com', emailVerified: true }, { ADMIN_EMAILS: 'a@x.com' })).toBe(false)
  })

  it('reads process.env when no env is given', () => {
    const previous = process.env.ADMIN_EMAILS
    process.env.ADMIN_EMAILS = 'env-admin@x.com'
    try {
      expect(isAdmin({ email: 'env-admin@x.com', emailVerified: true })).toBe(true)
    } finally {
      if (previous === undefined) delete process.env.ADMIN_EMAILS
      else process.env.ADMIN_EMAILS = previous
    }
  })
})
