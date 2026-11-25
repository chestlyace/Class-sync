import { describe, expect, it } from 'vitest'
import { isPhoneReset, runAsPhoneReset } from './phone-reset-scope'

const at = (path: string) => new Request(`http://localhost:3000${path}`, { method: 'POST' })

describe('isPhoneReset', () => {
  it('knows the WhatsApp reset route, with or without a trailing slash', () => {
    expect(isPhoneReset(at('/api/auth/phone-number/reset-password'))).toBe(true)
    expect(isPhoneReset(at('/api/auth/phone-number/reset-password/'))).toBe(true)
    expect(isPhoneReset(at('/api/auth/phone-number/reset-password//'))).toBe(true)
  })

  it('treats the emailed link and a server-side call without a request as an email reset', () => {
    expect(isPhoneReset(at('/api/auth/reset-password'))).toBe(false)
    expect(isPhoneReset(at('/api/auth/reset-password/'))).toBe(false)
    expect(isPhoneReset(undefined)).toBe(false)
  })

  it('is true inside the WhatsApp reset scope, whatever the request', async () => {
    expect(await runAsPhoneReset(async () => isPhoneReset(undefined))).toBe(true)
    expect(await runAsPhoneReset(async () => isPhoneReset(at('/api/auth/reset-password')))).toBe(true)
  })

  it('never assumes an email reset from a request whose address cannot be read', () => {
    expect(isPhoneReset({ url: 'not a url' } as Request)).toBe(true)
  })
})
