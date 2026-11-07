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
