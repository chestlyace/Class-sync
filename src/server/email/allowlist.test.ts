import { describe, expect, it } from 'vitest'
import { isAllowedRecipient } from './allowlist'

describe('isAllowedRecipient', () => {
  it('allows everyone on Vercel production, even with an allowlist set', () => {
    expect(isAllowedRecipient('x@y.com', { VERCEL_ENV: 'production', EMAIL_ALLOWLIST: 'a@b.com' })).toBe(true)
  })

  it('allows only listed addresses when EMAIL_ALLOWLIST is set outside production', () => {
    const env = { VERCEL_ENV: 'preview', EMAIL_ALLOWLIST: ' Ace@X.com, b@y.com ,' }
    expect(isAllowedRecipient('ace@x.com', env)).toBe(true)
    expect(isAllowedRecipient('B@Y.COM', env)).toBe(true)
    expect(isAllowedRecipient('c@z.com', env)).toBe(false)
    expect(isAllowedRecipient('Ace <ace@x.com>', env)).toBe(false)
  })

  it('sends nothing on a preview without an allowlist', () => {
    expect(isAllowedRecipient('ace@x.com', { VERCEL_ENV: 'preview' })).toBe(false)
    expect(isAllowedRecipient('ace@x.com', { VERCEL_ENV: 'preview', EMAIL_ALLOWLIST: ' , ' })).toBe(false)
  })

  it('allows everyone locally when no allowlist is set', () => {
    expect(isAllowedRecipient('ace@x.com', {})).toBe(true)
  })
})
