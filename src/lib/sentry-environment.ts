/**
 * Sentry's environment tag. Staging is Vercel's preview deployment of the Development branch, so
 * VERCEL_ENV alone would file it with every other preview.
 */
export function sentryEnvironment(vercelEnv: string | undefined, branch: string | undefined): string {
  if (vercelEnv === 'production') return 'production'
  if (vercelEnv === 'preview') return branch === 'Development' ? 'staging' : 'preview'
  return 'development'
}
