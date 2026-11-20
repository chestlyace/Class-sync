import * as Sentry from '@sentry/nextjs'
import { deployEnv } from '@/lib/deploy-env'
import {
  isNextRequestErrorLog,
  isNodeWarningLog,
  withoutResetToken,
  withoutResetTokenInBreadcrumb,
  withoutResetTokenInSpan,
  withoutVisitorIp,
} from '@/lib/sentry-filters'

/**
 * Server error tracking (Sentry). Off while NEXT_PUBLIC_SENTRY_DSN is unset, so locally and in
 * tests nothing is sent. sendDefaultPii stays off: no IPs, cookies or request bodies leave the app.
 */
export function register() {
  Sentry.init({
    dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
    environment: deployEnv(),
    tracesSampleRate: 0.1,
    beforeSend: (event) => withoutVisitorIp(withoutResetToken(event)),
    beforeBreadcrumb: withoutResetTokenInBreadcrumb,
    beforeSendSpan: withoutResetTokenInSpan,
  })
  if (Sentry.isEnabled()) reportLoggedErrors()
  if (process.env.NEXT_RUNTIME === 'nodejs' && process.env.NEXT_PHASE !== 'phase-production-build') {
    void startBackgroundJobs()
  }
}

/**
 * Heroku: background jobs run in this server process (src/server/jobs/worker.ts). Started without
 * holding up the server; a failure is logged (and so reported) and the site keeps serving.
 */
async function startBackgroundJobs() {
  const { queueDriver } = await import('@/server/jobs/driver')
  if (queueDriver() !== 'pgboss') return
  try {
    const { startJobWorkers } = await import('@/server/jobs/worker')
    await startJobWorkers()
    console.log('[jobs] background job workers started')
  } catch (error) {
    console.error('[jobs] background job workers failed to start', error)
  }
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
    if (isNextRequestErrorLog(args) || isNodeWarningLog(args)) return
    const error = args.find((arg) => arg instanceof Error)
    const context = { level: 'error' as const, tags: { logged: 'console' }, extra: { arguments: args } }
    if (error) Sentry.captureException(error, context)
    else Sentry.captureMessage(args.map(String).join(' '), context)
  }
}
