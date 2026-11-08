import { createHash, randomBytes } from 'node:crypto'
import { createAuth } from '@/server/auth/auth'
import type { Db } from '@/server/db'

type AuthInstance = ReturnType<typeof createAuth>

export const TEST_ORIGIN = 'http://localhost:3000'

/** A Better Auth instance (with the MCP plugins) on a test database. */
export function createTestAuth(db: Db) {
  return createAuth(db, {
    baseURL: TEST_ORIGIN,
    secret: 'test-secret-test-secret-test-secret-123',
    nextCookies: false,
  })
}

/** Test helpers: drive Better Auth's OAuth provider through its handler, like an assistant would. */

export const REDIRECT_URI = 'http://localhost:9999/callback'

export function authRequest(path: string, init: { method?: string; body?: unknown; form?: Record<string, string>; cookie?: string } = {}) {
  const headers: Record<string, string> = { origin: TEST_ORIGIN }
  let body: string | undefined
  if (init.form) {
    headers['content-type'] = 'application/x-www-form-urlencoded'
    body = new URLSearchParams(init.form).toString()
  } else if (init.body !== undefined) {
    headers['content-type'] = 'application/json'
    body = JSON.stringify(init.body)
  }
  if (init.cookie) headers.cookie = init.cookie
  return new Request(`${TEST_ORIGIN}${path}`, { method: init.method ?? (body ? 'POST' : 'GET'), headers, body, redirect: 'manual' })
}

export function cookiesOf(res: Response): string {
  return res.headers
    .getSetCookie()
    .map((c) => c.split(';')[0])
    .join('; ')
}

export async function signUp(auth: AuthInstance, role: 'lecturer' | 'student', email: string) {
  const res = await auth.handler(
    authRequest('/api/auth/sign-up/email', { body: { name: `Test ${role}`, email, password: 'correct-horse-9', role, locale: 'en' } }),
  )
  if (res.status !== 200) throw new Error(`sign-up failed: ${res.status} ${await res.text()}`)
  const json = (await res.json()) as { user: { id: string } }
  return { cookie: cookiesOf(res), userId: json.user.id }
}

export async function registerClient(auth: AuthInstance, name = 'Test Assistant', redirectUris: string[] = [REDIRECT_URI]) {
  const res = await auth.handler(
    authRequest('/api/auth/oauth2/register', {
      body: {
        client_name: name,
        redirect_uris: redirectUris,
        token_endpoint_auth_method: 'none',
        grant_types: ['authorization_code', 'refresh_token'],
        response_types: ['code'],
      },
    }),
  )
  if (res.status !== 200 && res.status !== 201) throw new Error(`register failed: ${res.status} ${await res.text()}`)
  return ((await res.json()) as { client_id: string }).client_id
}

export function pkce() {
  const verifier = randomBytes(32).toString('base64url')
  const challenge = createHash('sha256').update(verifier).digest('base64url')
  return { verifier, challenge }
}

/** authorize → consent (accept) → token. Returns the token response and intermediate steps. */
export async function runOAuthFlow(
  auth: AuthInstance,
  { clientId, cookie, scope = 'openid offline_access clasync:read clasync:write', resource = `${TEST_ORIGIN}/api/mcp` }: {
    clientId: string
    cookie: string
    scope?: string
    resource?: string | null
  },
) {
  const { verifier, challenge } = pkce()
  const params = new URLSearchParams({
    response_type: 'code',
    client_id: clientId,
    redirect_uri: REDIRECT_URI,
    scope,
    state: 'state-123',
    code_challenge: challenge,
    code_challenge_method: 'S256',
  })
  if (resource) params.set('resource', resource)
  const authorize = await auth.handler(authRequest(`/api/auth/oauth2/authorize?${params}`, { cookie }))
  const consentLocation = authorize.headers.get('location')
  if (!consentLocation) throw new Error(`authorize did not redirect: ${authorize.status} ${await authorize.text()}`)
  const consentUrl = new URL(consentLocation, TEST_ORIGIN)
  const consent = await auth.handler(
    authRequest('/api/auth/oauth2/consent', { body: { accept: true, oauth_query: consentUrl.search.slice(1) }, cookie }),
  )
  const consentJson = (await consent.json()) as { redirect?: boolean; url?: string }
  if (!consentJson.url) throw new Error(`consent failed: ${consent.status} ${JSON.stringify(consentJson)}`)
  const code = new URL(consentJson.url).searchParams.get('code')
  if (!code) throw new Error(`no code in ${consentJson.url}`)
  const form: Record<string, string> = {
    grant_type: 'authorization_code',
    code,
    redirect_uri: REDIRECT_URI,
    client_id: clientId,
    code_verifier: verifier,
  }
  if (resource) form.resource = resource
  const tokenRes = await auth.handler(authRequest('/api/auth/oauth2/token', { form }))
  const tokens = (await tokenRes.json()) as { access_token?: string; refresh_token?: string; scope?: string; error?: string }
  if (!tokens.access_token) throw new Error(`token failed: ${tokenRes.status} ${JSON.stringify(tokens)}`)
  return { consentUrl, tokens: tokens as { access_token: string; refresh_token?: string; scope?: string } }
}

/** GET authorize as the signed-in user; returns the consent page's signed query (no leading `?`). */
export async function authorizeToConsent(
  auth: AuthInstance,
  { clientId, cookie, redirectUri = REDIRECT_URI }: { clientId: string; cookie: string; redirectUri?: string },
): Promise<string> {
  const { challenge } = pkce()
  const params = new URLSearchParams({
    response_type: 'code',
    client_id: clientId,
    redirect_uri: redirectUri,
    scope: 'openid offline_access clasync:read clasync:write',
    state: 's',
    code_challenge: challenge,
    code_challenge_method: 'S256',
    resource: `${TEST_ORIGIN}/api/mcp`,
  })
  const res = await auth.handler(authRequest(`/api/auth/oauth2/authorize?${params}`, { cookie }))
  const location = res.headers.get('location')
  if (!location) throw new Error(`authorize did not redirect: ${res.status} ${await res.text()}`)
  return new URL(location, TEST_ORIGIN).search.slice(1)
}
