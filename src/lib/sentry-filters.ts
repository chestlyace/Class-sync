import type { Breadcrumb, Event } from '@sentry/nextjs'

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

// Node codes are usually numeric (DEP0040), but libraries emit their own, e.g. the AI SDK's
// AISDK_DEP_IMAGE_CONTENT_PART. Allow letters, digits, underscores and dashes in the code.
const NODE_WARNING = /^\(node:\d+\) (?:\[[A-Z][A-Z0-9_-]*\] )?\w*Warning: /

/**
 * True for a runtime warning Node prints by itself, such as "(node:8) ExperimentalWarning: …" at
 * every cold start on Vercel. It goes through console.error but isn't a failure in the app, so the
 * server leaves it out of Sentry (it filled CLASYNC-5 with thousands of events). Library codes
 * without a digit were missed, which brought it back as CLASYNC-13.
 */
export function isNodeWarningLog(args: unknown[]): boolean {
  return args.length === 1 && typeof args[0] === 'string' && NODE_WARNING.test(args[0])
}

// Better Auth's logger writes "<ISO time> ERROR [Better Auth]: <message>" (ANSI colours when the
// terminal has them). Only outcomes the app already handles for the user belong here.
const BETTER_AUTH_EXPECTED = /^\S+ ERROR \[Better Auth\]: (?:signup_disabled|account_not_linked)$/

/**
 * True for Better Auth's log of a Google sign-in it refused on purpose, which the sign-in and
 * sign-up pages explain to the visitor:
 * - `signup_disabled`: no Clasync account for that Google account (disableImplicitSignUp); was
 *   filling CLASYNC-13.
 * - `account_not_linked`: an account with that email exists but its address isn't confirmed, so
 *   Google isn't joined to it (requireLocalEmailVerified); was filling CLASYNC-17.
 * Other link failures (`unable_to_link_account`, …) are still reported.
 */
export function isExpectedAuthLog(args: unknown[]): boolean {
  return (
    args.length === 1 && typeof args[0] === 'string' && BETTER_AUTH_EXPECTED.test(args[0].replace(ANSI_COLOUR, ''))
  )
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

const RESET_TOKEN_PARAM = 'token'

/**
 * Drops the `token` query parameter from a URL, absolute or same-site relative. Sentry masks token
 * *values* by default but still keeps the key and its value as `[Filtered]`; a password-reset link
 * must not carry the live token anywhere, so remove the parameter entirely.
 */
function withoutTokenInUrl(value: unknown): unknown {
  if (typeof value !== 'string' || !value.includes(`${RESET_TOKEN_PARAM}=`)) return value
  const absolute = /^[a-z][a-z\d+.-]*:\/\//i.test(value)
  if (!absolute && !value.startsWith('/')) return value
  try {
    const url = new URL(value, 'http://clasync.invalid')
    if (!url.searchParams.has(RESET_TOKEN_PARAM)) return value
    url.searchParams.delete(RESET_TOKEN_PARAM)
    return absolute ? url.toString() : `${url.pathname}${url.search}${url.hash}`
  } catch {
    return value
  }
}

function scrubUrlAttributes(attributes: Record<string, unknown> | undefined): void {
  if (!attributes) return
  for (const [key, value] of Object.entries(attributes)) {
    const clean = withoutTokenInUrl(value)
    if (clean !== value) attributes[key] = clean
  }
}

/** Applied in `beforeSend` on both client and server. */
export function withoutResetToken<T extends Event>(event: T): T {
  if (event.request?.url) event.request.url = withoutTokenInUrl(event.request.url) as string
  for (const breadcrumb of event.breadcrumbs ?? []) withoutResetTokenInBreadcrumb(breadcrumb)
  for (const span of event.spans ?? []) scrubUrlAttributes(span.data as Record<string, unknown> | undefined)
  return event
}

/** Applied in `beforeBreadcrumb`, so navigation crumbs never hold the token either. */
export function withoutResetTokenInBreadcrumb<T extends Breadcrumb>(breadcrumb: T): T {
  if (breadcrumb.message) breadcrumb.message = withoutTokenInUrl(breadcrumb.message) as string
  scrubUrlAttributes(breadcrumb.data)
  return breadcrumb
}

/** Applied in `beforeSendSpan` (v11 ignores `beforeSendTransaction` with streamed traces). */
export function withoutResetTokenInSpan<T extends { attributes?: Record<string, unknown> }>(span: T): T {
  scrubUrlAttributes(span.attributes)
  return span
}
