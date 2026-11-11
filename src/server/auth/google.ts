/** Google sign-in credentials from the environment, or null when they are not both set. */
export function googleCredentials(
  env: Record<string, string | undefined> = process.env,
): { clientId: string; clientSecret: string } | null {
  const clientId = env.GOOGLE_CLIENT_ID?.trim()
  const clientSecret = env.GOOGLE_CLIENT_SECRET?.trim()
  return clientId && clientSecret ? { clientId, clientSecret } : null
}

/** True when "Continue with Google" is offered (both credentials are set). */
export function isGoogleSignInEnabled(env: Record<string, string | undefined> = process.env): boolean {
  return googleCredentials(env) !== null
}

/**
 * The role and locale picked on the sign-up page, carried through Google in the OAuth state
 * (`additionalData` of `signIn.social`). Client-supplied: the user create hook validates them
 * (assertValidSignup) exactly as for an email sign-up. Keys that are absent stay absent, so a
 * Google sign-up without a role fails instead of creating a role-less account.
 */
export function signupFieldsFromOAuthState(state: Record<string, unknown> | null | undefined): {
  role?: unknown
  locale?: unknown
} {
  if (!state) return {}
  return {
    ...(state.role !== undefined ? { role: state.role } : {}),
    ...(state.locale !== undefined ? { locale: state.locale } : {}),
  }
}
