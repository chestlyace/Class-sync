import type { Event } from '@sentry/nextjs'

const ANSI_COLOUR =new RegExp(`${String.fromCharCode(27)}\\[\\d+m`, 'g')

/**
 * True for Next.js's own log of a failed request: console.error('⨯', error), written just before
 * its onRequestError hook runs. Sentry reports an error object only once, so capturing this log
 * would swallow the hook's fuller report (route, request); the server skips it instead.
 */
export function isNextRequestErrorLog(args: unknown[]): boolean {
  const [first, second] = args
  return typeof first === 'string' && first.replace(ANSI_COLOUR, '') === '⨯' && second instanceof Error
}

/**
 * Even with personal data off, Sentry reads a visitor's IP from forwarding headers
 * (x-forwarded-for on Vercel). Keep only the user agent, which says which browser failed.
 */
export function withoutVisitorIp<T extends Event>(event: T): T {
  if (event.request?.headers) {
    const userAgent = event.request.headers['user-agent']
    event.request.headers = userAgent ? { 'user-agent': userAgent } : {}
  }
  if (event.user) delete event.user.ip_address
  return event
}
