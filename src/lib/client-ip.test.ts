import { describe, expect, it } from 'vitest'
import { forwardedClientIp } from './client-ip'

const h = (init: Record<string, string>) => new Headers(init)

describe('forwardedClientIp', () => {
  it('takes the first x-forwarded-for entry on Vercel', () => {
    expect(forwardedClientIp(h({ 'x-forwarded-for': '203.0.113.9, 10.0.0.1' }), {})).toBe('203.0.113.9')
  })

  it("takes the last entry on Heroku, where the client's own value comes first", () => {
    expect(forwardedClientIp(h({ 'x-forwarded-for': '1.2.3.4, 203.0.113.9' }), { DYNO: 'web.1' })).toBe('203.0.113.9')
    expect(forwardedClientIp(h({ 'x-forwarded-for': '203.0.113.9' }), { DYNO: 'web.1' })).toBe('203.0.113.9')
  })

  it('falls back to x-real-ip, then null, and cuts long values', () => {
    expect(forwardedClientIp(h({ 'x-real-ip': ' 198.51.100.4 ' }), {})).toBe('198.51.100.4')
    expect(forwardedClientIp(h({}), {})).toBeNull()
    expect(forwardedClientIp(h({ 'x-forwarded-for': 'x'.repeat(100) }), {})).toHaveLength(64)
  })
})
