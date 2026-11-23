import { isHostedTestDeploy } from '@/lib/deploy-env'

export type Config = {
  requireEmailVerification: boolean
  /** IANA time zone in which class sessions are scheduled. */
  timeZone: string
}

export const config: Config = {
  requireEmailVerification: process.env.AUTH_REQUIRE_EMAIL_VERIFICATION !== 'false',
  timeZone: process.env.APP_TIME_ZONE || 'Africa/Douala',
}

/** Test-only: override config values in place (callers restore them afterwards). */
export function setConfigForTests(overrides: Partial<Config>): void {
  Object.assign(config, overrides)
}

/** True on a hosted test build: staging (branch Development) and other previews. */
export function isPreviewDeployment(env: Record<string, string | undefined> = process.env): boolean {
  return isHostedTestDeploy(env)
}
