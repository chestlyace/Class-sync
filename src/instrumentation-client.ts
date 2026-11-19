import * as Sentry from '@sentry/nextjs'
import { sentryEnvironment } from '@/lib/sentry-environment'
import { withoutResetToken, withoutResetTokenInBreadcrumb, withoutResetTokenInSpan } from '@/lib/sentry-filters'

// Browser error tracking; see instrumentation.ts. No session replay: pages show students' names and marks.
Sentry.init({
  dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
  // Vercel exposes these system variables to Next.js builds with the NEXT_PUBLIC_ prefix.
  environment: sentryEnvironment(process.env.NEXT_PUBLIC_VERCEL_ENV, process.env.NEXT_PUBLIC_VERCEL_GIT_COMMIT_REF),
  tracesSampleRate: 0.1,
  beforeSend: withoutResetToken,
  beforeBreadcrumb: withoutResetTokenInBreadcrumb,
  beforeSendSpan: withoutResetTokenInSpan,
})

export const onRouterTransitionStart = Sentry.captureRouterTransitionStart
