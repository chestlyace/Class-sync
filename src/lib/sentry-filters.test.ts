import type { Event } from '@sentry/nextjs'
import { describe, expect, it } from 'vitest'
import { isNextRequestErrorLog, withoutVisitorIp } from './sentry-filters'

describe('withoutVisitorIp', () => {
  it('keeps only the user agent from the request headers and drops any user IP', () => {
    const event: Event = {
      request: {
        url: '/api/x',
        headers: { 'user-agent': 'Firefox', 'x-forwarded-for': '41.202.1.1', 'x-real-ip': '41.202.1.1', referer: '/t/ABC' },
      },
      user: { ip_address: '41.202.1.1', id: 'u1' },
    }
    expect(withoutVisitorIp(event)).toEqual({
      request: { url: '/api/x', headers: { 'user-agent': 'Firefox' } },
      user: { id: 'u1' },
    })
  })

  it('leaves events without a request or user alone', () => {
    expect(withoutVisitorIp({ message: 'hi' })).toEqual({ message: 'hi' })
    expect(withoutVisitorIp({ request: { headers: { 'x-forwarded-for': '1.1.1.1' } } })).toEqual({ request: { headers: {} } })
  })
})

describe('isNextRequestErrorLog', () => {
  it("spots Next's own log of a failed request, with or without colours", () => {
    expect(isNextRequestErrorLog(['⨯', new Error('boom')])).toBe(true)
    expect(isNextRequestErrorLog(['\u001b[31m\u001b[1m⨯\u001b[22m\u001b[39m', new Error('boom')])).toBe(true)
  })

  it('keeps our own logged failures and other Next messages', () => {
    expect(isNextRequestErrorLog(['[cron/reminders] run failed', new Error('boom')])).toBe(false)
    expect(isNextRequestErrorLog(['⨯ Failed to load the config'])).toBe(false)
    expect(isNextRequestErrorLog(['⨯', 'not an error'])).toBe(false)
    expect(isNextRequestErrorLog([])).toBe(false)
  })
})
