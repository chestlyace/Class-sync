export type Config = {
  requireEmailVerification: boolean
}

export const config: Config = {
  requireEmailVerification: process.env.AUTH_REQUIRE_EMAIL_VERIFICATION !== 'false',
}

/** Test-only: override config values in place (callers restore them afterwards). */
export function setConfigForTests(overrides: Partial<Config>): void {
  Object.assign(config, overrides)
}
