import { verifyOAuthQueryParams } from '@better-auth/oauth-provider'
import { and, asc, count, desc, eq, gt, isNull, or } from 'drizzle-orm'
import type { createAuth } from '@/server/auth/auth'
import type { Ctx } from '@/server/core/context'
import { AppError } from '@/server/core/errors'
import { requireRole } from '@/server/core/guards'
import { db } from '@/server/db'
import { apikey, oauthAccessToken, oauthClient, oauthConsent, oauthRefreshToken } from '@/server/db/schema'
import { describeRedirect, isRegisteredRedirect, type RedirectTarget } from './redirect-target'

// Lecturers' assistant connections: personal access tokens (api-key plugin) and the OAuth apps
// they allowed (oauth-provider consents). Better Auth owns these tables; the app lists and revokes.

/** The Better Auth instance; tests pass one built on their own database. */
export type AuthInstance = ReturnType<typeof createAuth>

async function defaultAuth(): Promise<AuthInstance> {
  return (await import('@/server/auth/auth')).auth
}

export const MAX_ACCESS_TOKENS = 10
export const TOKEN_NAME_MAX = 60
export const TOKEN_EXPIRY_DAYS = [30, 90, null] as const
export type TokenExpiryDays = (typeof TOKEN_EXPIRY_DAYS)[number]

export type AccessTokenSummary = {
  id: string
  name: string
  /** The first characters, e.g. `cls_ab12`, to tell tokens apart. */
  start: string | null
  createdAt: Date
  lastUsedAt: Date | null
  expiresAt: Date | null
}

export type ConnectedApp = {
  clientId: string
  name: string | null
  icon: string | null
  uri: string | null
  scopes: string[]
  connectedAt: Date
}

export type ConsentClient = { clientId: string; name: string | null; icon: string | null; uri: string | null }

const DAY_MS = 86_400_000

function activeKeyFilter(userId: string) {
  return and(
    eq(apikey.referenceId, userId),
    eq(apikey.enabled, true),
    or(isNull(apikey.expiresAt), gt(apikey.expiresAt, new Date())),
  )
}

/**
 * Creates a personal access token for the lecturer. The plugin creates it, so it is hashed the way
 * `verifyApiKey` expects; `key` is returned once and never stored in clear.
 */
export async function createAccessToken(
  ctx: Ctx,
  input: { name: string; expiresInDays: TokenExpiryDays },
  auth?: AuthInstance,
): Promise<{ id: string; key: string }> {
  requireRole(ctx, 'lecturer')
  const name = typeof input.name === 'string' ? input.name.trim() : ''
  if (name.length < 1 || name.length > TOKEN_NAME_MAX) {
    throw new AppError('VALIDATION', `Name must be 1 to ${TOKEN_NAME_MAX} characters`, { field: 'name' })
  }
  if (!TOKEN_EXPIRY_DAYS.includes(input.expiresInDays)) {
    throw new AppError('VALIDATION', 'Expiry must be 30 days, 90 days or never', { field: 'expiresInDays' })
  }
  const [{ n }] = await ctx.db.select({ n: count() }).from(apikey).where(activeKeyFilter(ctx.user.id))
  if (n >= MAX_ACCESS_TOKENS) {
    throw new AppError('CONFLICT', `At most ${MAX_ACCESS_TOKENS} active tokens; revoke one first`, { max: MAX_ACCESS_TOKENS })
  }
  const a = auth ?? (await defaultAuth())
  const created = await a.api.createApiKey({
    body: {
      name,
      expiresIn: input.expiresInDays === null ? null : (input.expiresInDays * DAY_MS) / 1000,
      userId: ctx.user.id,
    },
  })
  // The count above and this insert are not atomic (the plugin writes through its own adapter, so
  // it can't join a transaction here). Settle races afterwards instead: of the active tokens, the
  // first MAX_ACCESS_TOKENS by creation stand; a token created past them is deleted at once and
  // its key never returned. Concurrent requests rank the same rows the same way.
  const ranked = await ctx.db
    .select({ id: apikey.id })
    .from(apikey)
    .where(activeKeyFilter(ctx.user.id))
    .orderBy(asc(apikey.createdAt), asc(apikey.id))
  if (ranked.findIndex((r) => r.id === created.id) >= MAX_ACCESS_TOKENS) {
    await ctx.db.delete(apikey).where(eq(apikey.id, created.id))
    throw new AppError('CONFLICT', `At most ${MAX_ACCESS_TOKENS} active tokens; revoke one first`, { max: MAX_ACCESS_TOKENS })
  }
  return { id: created.id, key: created.key }
}

/** The lecturer's tokens that are still enabled (expired ones included, to show and revoke). */
export async function listAccessTokens(ctx: Ctx): Promise<AccessTokenSummary[]> {
  requireRole(ctx, 'lecturer')
  const rows = await ctx.db
    .select({
      id: apikey.id,
      name: apikey.name,
      start: apikey.start,
      createdAt: apikey.createdAt,
      lastUsedAt: apikey.lastRequest,
      expiresAt: apikey.expiresAt,
    })
    .from(apikey)
    .where(and(eq(apikey.referenceId, ctx.user.id), eq(apikey.enabled, true)))
    .orderBy(desc(apikey.createdAt))
  return rows.map((r) => ({ ...r, name: r.name ?? '' }))
}

/** Disables one of the lecturer's tokens. Someone else's (or no such) token: FORBIDDEN. */
export async function revokeAccessToken(ctx: Ctx, id: string, auth?: AuthInstance): Promise<void> {
  requireRole(ctx, 'lecturer')
  const [row] = await ctx.db
    .select({ referenceId: apikey.referenceId })
    .from(apikey)
    .where(eq(apikey.id, String(id)))
  if (!row || row.referenceId !== ctx.user.id) throw new AppError('FORBIDDEN', 'Token not found or not yours')
  const a = auth ?? (await defaultAuth())
  await a.api.updateApiKey({ body: { keyId: String(id), userId: ctx.user.id, enabled: false } })
}

/** The OAuth apps (assistants) this lecturer allowed, newest first. */
export async function listConnectedApps(ctx: Ctx): Promise<ConnectedApp[]> {
  requireRole(ctx, 'lecturer')
  const rows = await ctx.db
    .select({
      clientId: oauthConsent.clientId,
      name: oauthClient.name,
      icon: oauthClient.icon,
      uri: oauthClient.uri,
      scopes: oauthConsent.scopes,
      connectedAt: oauthConsent.createdAt,
    })
    .from(oauthConsent)
    .innerJoin(oauthClient, eq(oauthClient.clientId, oauthConsent.clientId))
    .where(eq(oauthConsent.userId, ctx.user.id))
    .orderBy(desc(oauthConsent.createdAt))
  // The client chose these at registration: show https ones only (as on the consent page).
  return rows.map((r) => ({ ...r, icon: safeHttpsUrl(r.icon), uri: safeHttpsUrl(r.uri) }))
}

/**
 * Disconnects an app: deletes the lecturer's consent and their access and refresh tokens for it.
 * Access tokens are JWTs that outlive their row, so the MCP endpoint also requires a consent.
 */
export async function disconnectApp(ctx: Ctx, clientId: string): Promise<void> {
  requireRole(ctx, 'lecturer')
  const id = String(clientId)
  await ctx.db.transaction(async (tx) => {
    const deleted = await tx
      .delete(oauthConsent)
      .where(and(eq(oauthConsent.userId, ctx.user.id), eq(oauthConsent.clientId, id)))
      .returning({ id: oauthConsent.id })
    if (deleted.length === 0) throw new AppError('FORBIDDEN', 'App not found or not connected')
    await tx
      .delete(oauthAccessToken)
      .where(and(eq(oauthAccessToken.userId, ctx.user.id), eq(oauthAccessToken.clientId, id)))
    await tx
      .delete(oauthRefreshToken)
      .where(and(eq(oauthRefreshToken.userId, ctx.user.id), eq(oauthRefreshToken.clientId, id)))
  })
}

/**
 * Whether the user has a consent for this client and the client is not disabled (checked on every
 * OAuth MCP call, so disconnecting or disabling cuts access before the JWT expires).
 */
export async function hasConsent(database: Ctx['db'], userId: string, clientId: string): Promise<boolean> {
  const [row] = await database
    .select({ id: oauthConsent.id })
    .from(oauthConsent)
    .innerJoin(oauthClient, eq(oauthClient.clientId, oauthConsent.clientId))
    .where(
      and(
        eq(oauthConsent.userId, userId),
        eq(oauthConsent.clientId, clientId),
        or(isNull(oauthClient.disabled), eq(oauthClient.disabled, false)),
      ),
    )
    .limit(1)
  return Boolean(row)
}

/** Only https icons are shown (no data: or http: images on the consent page). */
function safeHttpsUrl(value: string | null): string | null {
  if (!value) return null
  try {
    return new URL(value).protocol === 'https:' ? value : null
  } catch {
    return null
  }
}

/** The client named on the consent page; null when unknown or disabled. */
export async function getConsentClient(clientId: string, database: Ctx['db'] = db): Promise<ConsentClient | null> {
  if (typeof clientId !== 'string' || clientId.length === 0 || clientId.length > 2048) return null
  const [row] = await database
    .select({
      clientId: oauthClient.clientId,
      name: oauthClient.name,
      icon: oauthClient.icon,
      uri: oauthClient.uri,
      disabled: oauthClient.disabled,
    })
    .from(oauthClient)
    .where(eq(oauthClient.clientId, clientId))
  if (!row || row.disabled) return null
  return { clientId: row.clientId, name: row.name, icon: safeHttpsUrl(row.icon), uri: safeHttpsUrl(row.uri) }
}

export type ConsentRequest =
  | { status: 'invalid' }
  | { status: 'unknown-client' }
  | {
      status: 'ok'
      client: ConsentClient & {
        /** Client ID Metadata Document clients: the host their client_id (a URL) names. */
        metadataHost: string | null
      }
      redirect: RedirectTarget
      scopes: string[]
    }

/**
 * What the consent page shows, from its signed query: the client, where the code will go (the
 * signed `redirect_uri`, which the provider uses, checked against the client's registered URIs)
 * and the scopes. A bad or expired signature is `invalid`: Allow would fail anyway.
 */
export async function describeConsentRequest(
  query: string,
  deps: { auth?: AuthInstance; db?: Ctx['db'] } = {},
): Promise<ConsentRequest> {
  const a = deps.auth ?? (await defaultAuth())
  const { secret } = await a.$context
  if (!(await verifyOAuthQueryParams(query, secret))) return { status: 'invalid' }
  const params = new URLSearchParams(query)
  const clientId = params.get('client_id') ?? ''
  const redirectUri = params.get('redirect_uri') ?? ''
  if (!clientId || clientId.length > 2048) return { status: 'unknown-client' }
  const [row] = await (deps.db ?? db)
    .select({
      clientId: oauthClient.clientId,
      name: oauthClient.name,
      icon: oauthClient.icon,
      uri: oauthClient.uri,
      disabled: oauthClient.disabled,
      redirectUris: oauthClient.redirectUris,
      clientDiscoveryId: oauthClient.clientDiscoveryId,
    })
    .from(oauthClient)
    .where(eq(oauthClient.clientId, clientId))
  if (!row || row.disabled) return { status: 'unknown-client' }
  const redirect = describeRedirect(redirectUri)
  if (!redirect || !isRegisteredRedirect(row.redirectUris, redirectUri)) return { status: 'invalid' }
  let metadataHost: string | null = null
  if (row.clientDiscoveryId) {
    try {
      metadataHost = new URL(row.clientId).host
    } catch {
      metadataHost = null
    }
  }
  return {
    status: 'ok',
    client: { clientId: row.clientId, name: row.name, icon: safeHttpsUrl(row.icon), uri: safeHttpsUrl(row.uri), metadataHost },
    redirect,
    scopes: (params.get('scope') ?? '').split(' ').filter(Boolean),
  }
}
