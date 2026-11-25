import type { Event } from '@sentry/nextjs'
import { describe, expect, it } from 'vitest'
import {
  isExpectedAuthLog,
  isNextRequestErrorLog,
  isNodeWarningLog,
  withoutResetToken,
  withoutResetTokenInBreadcrumb,
  withoutResetTokenInSpan,
  withoutVisitorIp,
} from './sentry-filters'

describe('isNodeWarningLog', () => {
  it("spots Node's own runtime warnings, which it prints at every cold start", () => {
    expect(
      isNodeWarningLog([
        '(node:8) ExperimentalWarning: vm.USE_MAIN_CONTEXT_DEFAULT_LOADER is an experimental feature and might change at any time\n(Use `node --trace-warnings ...` to show where the warning was created)',
      ]),
    ).toBe(true)
    expect(isNodeWarningLog(['(node:4120) [DEP0040] DeprecationWarning: The `punycode` module is deprecated.'])).toBe(true)
    // Library codes need not contain a digit: the AI SDK's warning regressed CLASYNC-5 into CLASYNC-13.
    expect(
      isNodeWarningLog([
        '(node:2) [AISDK_DEP_IMAGE_CONTENT_PART] DeprecationWarning: AI SDK Warning: Deprecated: ""image"" content part". The "image" content part type is deprecated.',
      ]),
    ).toBe(true)
  })

  it('keeps our own logged failures and anything that merely mentions a warning', () => {
    expect(isNodeWarningLog(['[cron/reminders] run failed', new Error('boom')])).toBe(false)
    expect(isNodeWarningLog(['(node:8) ExperimentalWarning: x', new Error('boom')])).toBe(false)
    expect(isNodeWarningLog(['Warning: something we logged'])).toBe(false)
    expect(isNodeWarningLog([new Error('(node:8) ExperimentalWarning: x')])).toBe(false)
    expect(isNodeWarningLog([])).toBe(false)
  })
})

describe('isExpectedAuthLog', () => {
  const ESC = String.fromCharCode(27)

  it("spots Better Auth's log of a Google sign-in with no Clasync account, with or without colours", () => {
    expect(isExpectedAuthLog(['2026-11-24T13:43:31.560Z ERROR [Better Auth]: signup_disabled'])).toBe(true)
    expect(
      isExpectedAuthLog([
        `${ESC}[2m2026-11-24T13:43:31.560Z${ESC}[0m ${ESC}[31mERROR${ESC}[0m ${ESC}[1m[Better Auth]:${ESC}[0m signup_disabled`,
      ]),
    ).toBe(true)
  })

  it('keeps every other Better Auth error and our own logs', () => {
    expect(isExpectedAuthLog(['2026-11-24T13:43:31.560Z ERROR [Better Auth]: State not found', new Error('x')])).toBe(false)
    expect(isExpectedAuthLog(['2026-11-24T13:43:31.560Z ERROR [Better Auth]: unable_to_create_user'])).toBe(false)
    expect(isExpectedAuthLog(['2026-11-24T13:43:31.560Z ERROR [Better Auth]: signup_disabled', 'extra'])).toBe(false)
    expect(isExpectedAuthLog(['[auth] signup_disabled'])).toBe(false)
    expect(isExpectedAuthLog([new Error('signup_disabled')])).toBe(false)
    expect(isExpectedAuthLog([])).toBe(false)
  })
})

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

describe('withoutResetToken', () => {
  it('removes the token query parameter from event, breadcrumb and span URLs', () => {
    const event: Event = {
      request: { url: 'https://clasync.test/reset-password?token=secret123&next=%2Fdashboard' },
      breadcrumbs: [
        { message: '/reset-password?token=secret123', data: { url: '/reset-password?token=secret123&x=1' } },
        { message: '/sign-in', data: { url: '/sign-in?next=%2Fdashboard' } },
      ],
      spans: [{ data: { 'url.full': '/reset-password?token=secret123' } }] as unknown as NonNullable<Event['spans']>,
    }
    expect(withoutResetToken(event)).toEqual({
      request: { url: 'https://clasync.test/reset-password?next=%2Fdashboard' },
      breadcrumbs: [
        { message: '/reset-password', data: { url: '/reset-password?x=1' } },
        { message: '/sign-in', data: { url: '/sign-in?next=%2Fdashboard' } },
      ],
      spans: [{ data: { 'url.full': '/reset-password' } }],
    })
  })

  it('leaves events without a token alone', () => {
    const crumb = { message: '/dashboard?tab=1', data: { url: '/dashboard?tab=1' } }
    expect(withoutResetToken({ request: { url: '/dashboard?tab=1' }, breadcrumbs: [crumb] })).toEqual({
      request: { url: '/dashboard?tab=1' },
      breadcrumbs: [crumb],
    })
    expect(withoutResetTokenInBreadcrumb(crumb)).toBe(crumb)
    const span = { attributes: { 'url.full': '/dashboard?tab=1' } }
    expect(withoutResetTokenInSpan(span)).toBe(span)
    expect(span.attributes['url.full']).toBe('/dashboard?tab=1')
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
