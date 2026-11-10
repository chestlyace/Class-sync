export type Config = {
  requireEmailVerification: boolean
  /** IANA time zone in which class sessions are scheduled. */
  timeZone: string
  /** AI Gateway "provider/model" for mark suggestions, or "fake" for the deterministic fake (refused on Vercel production). */
  aiMarkingModel: string
}

export const config: Config = {
  requireEmailVerification: process.env.AUTH_REQUIRE_EMAIL_VERIFICATION !== 'false',
  timeZone: process.env.APP_TIME_ZONE || 'Africa/Douala',
  aiMarkingModel: process.env.AI_MARKING_MODEL?.trim() || 'openai/gpt-5-mini',
}

/** Test-only: override config values in place (callers restore them afterwards). */
export function setConfigForTests(overrides: Partial<Config>): void {
  Object.assign(config, overrides)
}

/** True on a Vercel preview deployment: staging (branch Development) and other preview branches. */
export function isPreviewDeployment(env: Record<string, string | undefined> = process.env): boolean {
  return env.VERCEL_ENV === 'preview'
}
