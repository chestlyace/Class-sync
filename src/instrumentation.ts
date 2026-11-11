import * as Sentry from '@sentry/nextjs'
import { sentryEnvironment } from '@/lib/sentry-environment'
import { isNextRequestErrorLog, withoutVisitorIp } from '@/lib/sentry-filters'

/**
 * Server error tracking (Sentry). Off while NEXT_PUBLIC_SENTRY_DSN is unset, so locally and in
 * tests nothing is sent. sendDefaultPii stays off: no IPs, cookies or request bodies leave the app.
 */
export function register() {
  Sentry.init({
    dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
    environment: sentryEnvironment(process.env.VERCEL_ENV, process.env.VERCEL_GIT_COMMIT_REF),
    tracesSampleRate: 0.1,
    beforeSend: withoutVisitorIp,
  })
  if (Sentry.isEnabled()) reportLoggedErrors()
}

export const onRequestError = Sentry.captureRequestError

/**
 * Many failures are caught and only logged (cron, emails, MCP tools, file storage): report those
 * too. Sentry's captureConsoleIntegration can't skip Next's own request-error log, which would
 * swallow onRequestError's report of the same error, hence this small wrapper.
 */
function reportLoggedErrors() {
  const log = console.error
  console.error = (...args: unknown[]) => {
    log(...args)
    if (isNextRequestErrorLog(args)) return
    const error = args.find((arg) => arg instanceof Error)
    const context = { level: 'error' as const, tags: { logged: 'console' }, extra: { arguments: args } }
    if (error) Sentry.captureException(error, context)
    else Sentry.captureMessage(args.map(String).join(' '), context)
  }
}
