type Env = Record<string, string | undefined>

/**
 * Where this copy of the app runs:
 * - `production`: the live site (clasync.online);
 * - `staging`: the shared test site, built from the Development branch;
 * - `preview`: another hosted test build (a Vercel preview of a feature branch);
 * - `development`: a laptop, CI or the tests.
 *
 * `APP_ENV` (`production` | `staging`) says it on hosts that set nothing themselves (Heroku). Vercel's own
 * variables are still read, so the same code runs on both while the move off Vercel is under way.
 */
export type DeployEnv = 'production' | 'staging' | 'preview' | 'development'

export function deployEnv(env: Env = process.env): DeployEnv {
  const app = env.APP_ENV?.trim()
  if (app === 'production' || app === 'staging') return app
  if (env.VERCEL_ENV === 'production') return 'production'
  if (env.VERCEL_ENV === 'preview') return env.VERCEL_GIT_COMMIT_REF === 'Development' ? 'staging' : 'preview'
  return 'development'
}

/** The live site. */
export function isProductionDeploy(env: Env = process.env): boolean {
  return deployEnv(env) === 'production'
}

/** A hosted test build: staging or another preview. */
export function isHostedTestDeploy(env: Env = process.env): boolean {
  const d = deployEnv(env)
  return d === 'staging' || d === 'preview'
}
