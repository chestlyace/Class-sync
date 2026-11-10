import * as Sentry from '@sentry/nextjs'

/**
 * Server error tracking (Sentry). Off while NEXT_PUBLIC_SENTRY_DSN is unset, so locally and in
 * tests nothing is sent. sendDefaultPii stays off: no IPs, cookies or request bodies leave the app.
 */
export function register() {
  Sentry.init({
    dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
    environment: process.env.VERCEL_ENV ?? 'development',
    tracesSampleRate: 0.1,
    // Many failures are caught and only logged (cron, emails, MCP tools, file storage): report those too.
    integrations: [Sentry.captureConsoleIntegration({ levels: ['error'] })],
  })
}

export const onRequestError = Sentry.captureRequestError
