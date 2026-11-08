import { eq } from 'drizzle-orm'
import { verifyJwsAccessToken } from 'better-auth/oauth2'
import { isLocale } from '@/i18n/locale'
import { API_KEY_PREFIX, mcpResourceUrl, resolveAppOrigin } from '@/server/auth/auth'
import type { Ctx, SessionUser } from '@/server/core/context'
import { isVerificationPending } from '@/server/core/guards'
import { db as defaultDb, type Db } from '@/server/db'
import { user } from '@/server/db/schema'
import type { McpScope } from './tool'
import { hasConsent, type AuthInstance } from './connections'

export type McpCaller = { ctx: Ctx; scopes: McpScope[]; clientId: string }

export type McpAuthDeps = { auth: AuthInstance; db: Db; origin: string }

const ALL_SCOPES: McpScope[] = ['clasync:read', 'clasync:write']
/** Hinted in the 401 challenge: offline_access gets the assistant a refresh token. */
const CHALLENGE_SCOPE = 'offline_access clasync:read clasync:write'
const LECTURERS_ONLY = "Clasync's assistant connection is for lecturers"

async function defaultDeps(): Promise<McpAuthDeps> {
  const { auth } = await import('@/server/auth/auth')
  return { auth, db: defaultDb, origin: resolveAppOrigin() }
}

/** `<origin>/.well-known/oauth-protected-resource/api/mcp` (RFC 9728), named in every 401. */
export function resourceMetadataUrl(origin: string): string {
  return `${origin}/.well-known/oauth-protected-resource/api/mcp`
}

function jsonRpcError(status: number, message: string, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify({ jsonrpc: '2.0', error: { code: -32000, message }, id: null }), {
    status,
    headers: { 'content-type': 'application/json', ...headers },
  })
}

/** 401 with the challenge MCP clients use to discover the authorization server. */
export function unauthorized(origin: string, invalidToken: boolean): Response {
  const params = [
    ...(invalidToken ? ['error="invalid_token"'] : []),
    `resource_metadata="${resourceMetadataUrl(origin)}"`,
    `scope="${CHALLENGE_SCOPE}"`,
  ]
  return jsonRpcError(401, invalidToken ? 'Invalid or expired token' : 'Authentication required', {
    'www-authenticate': `Bearer ${params.join(', ')}`,
  })
}

function bearerToken(req: Request): string | null {
  const header = req.headers.get('authorization')
  const match = header ? /^Bearer\s+(\S+)\s*$/i.exec(header) : null
  return match ? match[1] : null
}

type JwksFetch = Exclude<Parameters<typeof verifyJwsAccessToken>[1]['jwksFetch'], string>

/** JWKS read in-process (no HTTP fetch of our own /jwks); cached per auth instance by the caller. */
function localJwks(auth: AuthInstance): JwksFetch {
  return async () => (await auth.api.getJwks()) as Awaited<ReturnType<JwksFetch>>
}

type Verified = { userId: string; scopes: McpScope[]; clientId: string; viaOAuth: boolean } | { rateLimited: true } | null

async function verifyApiKey(auth: AuthInstance, key: string): Promise<Verified> {
  let result
  try {
    result = await auth.api.verifyApiKey({ body: { key } })
  } catch {
    return null
  }
  if (!result.valid || !result.key) {
    return result.error?.code === 'RATE_LIMITED' ? { rateLimited: true } : null
  }
  return { userId: result.key.referenceId, scopes: ALL_SCOPES, clientId: `token:${result.key.id}`, viaOAuth: false }
}

async function verifyOAuthToken(auth: AuthInstance, token: string, origin: string): Promise<Verified> {
  let payload
  try {
    payload = await verifyJwsAccessToken(token, {
      jwksFetch: localJwks(auth),
      jwksCacheKey: auth,
      verifyOptions: {
        issuer: `${origin}/api/auth`,
        audience: mcpResourceUrl(origin),
        typ: 'at+jwt',
        requiredClaims: ['sub', 'azp', 'exp'],
      },
    })
  } catch {
    return null
  }
  // Sender-constrained (DPoP) tokens need proof checks this endpoint does not do: refuse them.
  if (payload.cnf !== undefined) return null
  if (typeof payload.sub !== 'string' || typeof payload.azp !== 'string') return null
  const granted = typeof payload.scope === 'string' ? payload.scope.split(' ') : []
  const scopes = ALL_SCOPES.filter((s) => granted.includes(s))
  return { userId: payload.sub, scopes, clientId: payload.azp, viaOAuth: true }
}

/**
 * Who is calling the MCP endpoint. `Bearer cls_…` is a personal access token (both scopes);
 * anything else must be an OAuth access token (JWT) bound to `<origin>/api/mcp`, whose scopes
 * come from the token and whose app is still connected. The user must be a lecturer with a
 * verified email. Returns the caller, or the Response to send (401 / 403 / 429).
 */
export async function resolveMcpCaller(req: Request, deps?: McpAuthDeps): Promise<McpCaller | Response> {
  const { auth, db, origin } = deps ?? (await defaultDeps())
  const token = bearerToken(req)
  if (!token) return unauthorized(origin, false)

  const verified = token.startsWith(API_KEY_PREFIX)
    ? await verifyApiKey(auth, token)
    : await verifyOAuthToken(auth, token, origin)
  if (verified && 'rateLimited' in verified) {
    return jsonRpcError(429, 'Too many requests for this token; wait a minute', { 'retry-after': '60' })
  }
  if (!verified) return unauthorized(origin, true)

  const [row] = await db
    .select({
      id: user.id,
      name: user.name,
      email: user.email,
      role: user.role,
      locale: user.locale,
      emailVerified: user.emailVerified,
    })
    .from(user)
    .where(eq(user.id, verified.userId))
  if (!row) return unauthorized(origin, true)
  if (verified.viaOAuth && !(await hasConsent(db, row.id, verified.clientId))) return unauthorized(origin, true)

  if (row.role !== 'lecturer') return jsonRpcError(403, LECTURERS_ONLY)
  const sessionUser: SessionUser = {
    id: row.id,
    name: row.name,
    email: row.email,
    role: 'lecturer',
    locale: isLocale(row.locale) ? row.locale : 'en',
    emailVerified: row.emailVerified,
  }
  if (isVerificationPending(sessionUser)) return jsonRpcError(403, 'Verify your email address in Clasync first')

  return { ctx: { db, user: sessionUser }, scopes: verified.scopes, clientId: verified.clientId }
}
