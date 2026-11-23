import * as Sentry from '@sentry/nextjs'
import { deployEnv } from '@/lib/deploy-env'
import { withoutResetToken, withoutResetTokenInBreadcrumb, withoutResetTokenInSpan } from '@/lib/sentry-filters'

// Browser error tracking; see instrumentation.ts. No session replay: pages show students' names and marks.
Sentry.init({
  dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
  // NEXT_PUBLIC_APP_ENV is APP_ENV copied in at build (next.config.ts); Vercel exposes its own system
  // variables to builds with the NEXT_PUBLIC_ prefix.
  environment: deployEnv({
    APP_ENV: process.env.NEXT_PUBLIC_APP_ENV,
    VERCEL_ENV: process.env.NEXT_PUBLIC_VERCEL_ENV,
    VERCEL_GIT_COMMIT_REF: process.env.NEXT_PUBLIC_VERCEL_GIT_COMMIT_REF,
  }),
  tracesSampleRate: 0.1,
  beforeSend: withoutResetToken,
  beforeBreadcrumb: withoutResetTokenInBreadcrumb,
  beforeSendSpan: withoutResetTokenInSpan,
})

export const onRouterTransitionStart = Sentry.captureRouterTransitionStart
