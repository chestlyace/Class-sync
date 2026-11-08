/** Parameters the authorization server adds to sign the query it sends to the sign-in page. */
const SIGNATURE_PARAMS = new Set(['sig', 'exp', 'ba_iat', 'ba_pl', 'ba_param'])

/** The search params a page receives (Next's `searchParams`). */
type Search = Record<string, string | string[] | undefined>

/** True when the page was opened by an assistant's OAuth authorization (a signed query). */
export function isOAuthSignIn(search: Search): boolean {
  return typeof search.sig === 'string' && typeof search.client_id === 'string'
}

/**
 * Where to resume an assistant's authorization from scratch: the authorize endpoint with the
 * original request, without the signature (it expires within minutes). Used as `next` through
 * sign-up and email verification; once signed in, authorize sends the user on to consent.
 * Null when the page was not opened by an authorization request.
 */
export function oauthResumePath(search: Search): string | null {
  if (!isOAuthSignIn(search)) return null
  const params = new URLSearchParams()
  for (const [key, value] of Object.entries(search)) {
    if (SIGNATURE_PARAMS.has(key) || key === 'next' || value === undefined) continue
    for (const v of Array.isArray(value) ? value : [value]) params.append(key, v)
  }
  return `/api/auth/oauth2/authorize?${params}`
}

/** Paths served by route handlers, not pages: the client router can't open them. */
export function needsFullNavigation(path: string): boolean {
  return path.startsWith('/api/')
}
