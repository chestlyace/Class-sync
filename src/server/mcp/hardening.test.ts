import { eq } from 'drizzle-orm'
import { beforeAll, describe, expect, it } from 'vitest'
import { OAUTH_CLIENT_MANAGEMENT_PATHS } from '@/server/auth/auth'
import { setConfigForTests } from '@/server/core/config'
import type { Db } from '@/server/db'
import { apikey, oauthAccessToken, oauthClient, oauthConsent, oauthRefreshToken, user } from '@/server/db/schema'
import { createTestDb } from '@/test/db'
import { ctxFor, makeUser } from '@/test/factories'
import {
  authorizeToConsent,
  authRequest,
  createTestAuth,
  registerClient,
  runOAuthFlow,
  signUp,
  TEST_ORIGIN,
} from '@/test/mcp-oauth'
import { resolveMcpCaller, type McpCaller } from './auth'
import { createAccessToken, describeConsentRequest, hasConsent, MAX_ACCESS_TOKENS, type AuthInstance } from './connections'
import { pruneUnusedOauthClients } from './prune'

describe('MCP auth hardening', () => {
  let db: Db
  let auth: AuthInstance

  beforeAll(async () => {
    setConfigForTests({ requireEmailVerification: false })
    db = await createTestDb()
    auth = createTestAuth(db)
  })

  describe('client management over HTTP', () => {
    it('is closed to everyone, students included (404)', async () => {
      const { cookie } = await signUp(auth, 'student', `stu-crud-${crypto.randomUUID()}@example.com`)
      const create = await auth.handler(
        authRequest('/api/auth/oauth2/create-client', {
          body: { redirect_uris: ['https://attacker.example/cb'], client_name: 'Claude', skip_consent: true },
          cookie,
        }),
      )
      expect(create.status).toBe(404)
      for (const path of OAUTH_CLIENT_MANAGEMENT_PATHS) {
        const isGet = path.startsWith('/oauth2/get-')
        const res = await auth.handler(authRequest(`/api/auth${path}`, isGet ? { cookie } : { body: {}, cookie }))
        expect(res.status, path).toBe(404)
      }
    })

    it('a signed-in browser cannot register a client either; anonymous registration still works', async () => {
      const { cookie } = await signUp(auth, 'lecturer', `lec-dcr-${crypto.randomUUID()}@example.com`)
      const res = await auth.handler(
        authRequest('/api/auth/oauth2/register', {
          body: { client_name: 'x', redirect_uris: ['http://localhost:9999/callback'], token_endpoint_auth_method: 'none' },
          cookie,
        }),
      )
      expect(res.status).toBeGreaterThanOrEqual(400)
      await expect(registerClient(auth)).resolves.toBeTruthy()
    })
  })

  describe('consent', () => {
    it('a student allowing is refused (403); denying still answers with the redirect', async () => {
      const clientId = await registerClient(auth)
      const { cookie } = await signUp(auth, 'student', `stu-consent-${crypto.randomUUID()}@example.com`)
      const query = await authorizeToConsent(auth, { clientId, cookie })
      const allow = await auth.handler(authRequest('/api/auth/oauth2/consent', { body: { accept: true, oauth_query: query }, cookie }))
      expect(allow.status).toBe(403)
      const deny = await auth.handler(authRequest('/api/auth/oauth2/consent', { body: { accept: false, oauth_query: query }, cookie }))
      expect(deny.status).toBe(200)
      expect(((await deny.json()) as { url: string }).url).toContain('error=access_denied')
      expect(await db.select().from(oauthConsent).where(eq(oauthConsent.clientId, clientId))).toEqual([])
    })

    it('describes the request: loopback destination for a local client', async () => {
      const clientId = await registerClient(auth, 'Local CLI')
      const { cookie } = await signUp(auth, 'lecturer', `lec-desc-${crypto.randomUUID()}@example.com`)
      const query = await authorizeToConsent(auth, { clientId, cookie })
      const request = await describeConsentRequest(query, { auth, db })
      expect(request).toMatchObject({
        status: 'ok',
        client: { clientId, name: 'Local CLI', metadataHost: null },
        redirect: { display: 'localhost:9999', kind: 'loopback' },
      })
      expect(request.status === 'ok' && request.scopes).toContain('clasync:write')
    })

    it('names an unknown https destination, even when the client calls itself Claude', async () => {
      const clientId = await registerClient(auth, 'Claude', ['https://attacker.example/steal'])
      const { cookie } = await signUp(auth, 'lecturer', `lec-phish-${crypto.randomUUID()}@example.com`)
      const query = await authorizeToConsent(auth, { clientId, cookie, redirectUri: 'https://attacker.example/steal' })
      expect(await describeConsentRequest(query, { auth, db })).toMatchObject({
        status: 'ok',
        client: { name: 'Claude' },
        redirect: { display: 'attacker.example', kind: 'other' },
      })
    })

    it('a tampered or forged query is invalid', async () => {
      const clientId = await registerClient(auth)
      const { cookie } = await signUp(auth, 'lecturer', `lec-tamper-${crypto.randomUUID()}@example.com`)
      const query = await authorizeToConsent(auth, { clientId, cookie })
      const tampered = new URLSearchParams(query)
      tampered.set('redirect_uri', 'https://claude.ai/api/mcp/auth_callback')
      expect(await describeConsentRequest(tampered.toString(), { auth, db })).toEqual({ status: 'invalid' })
      expect(await describeConsentRequest(`client_id=${clientId}&redirect_uri=x`, { auth, db })).toEqual({ status: 'invalid' })
    })
  })

  it('a disabled client loses access even with a consent and a valid token', async () => {
    const clientId = await registerClient(auth)
    const { cookie, userId } = await signUp(auth, 'lecturer', `lec-disabled-${crypto.randomUUID()}@example.com`)
    const { tokens } = await runOAuthFlow(auth, { clientId, cookie })
    const deps = { auth, db, origin: TEST_ORIGIN }
    const req = () =>
      new Request(`${TEST_ORIGIN}/api/mcp`, { method: 'POST', headers: { authorization: `Bearer ${tokens.access_token}` } })
    expect(await resolveMcpCaller(req(), deps)).not.toBeInstanceOf(Response)
    await db.update(oauthClient).set({ disabled: true }).where(eq(oauthClient.clientId, clientId))
    expect(await hasConsent(db, userId, clientId)).toBe(false)
    const res = (await resolveMcpCaller(req(), deps)) as McpCaller | Response
    expect((res as Response).status).toBe(401)
  })

  it('concurrent token creation never passes the cap', async () => {
    const ctx = ctxFor(db, await makeUser(db, { role: 'lecturer' }))
    for (let i = 0; i < MAX_ACCESS_TOKENS - 1; i++) await createAccessToken(ctx, { name: `t${i}`, expiresInDays: 30 }, auth)
    const results = await Promise.allSettled(
      [1, 2, 3, 4].map((i) => createAccessToken(ctx, { name: `race${i}`, expiresInDays: 30 }, auth)),
    )
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1)
    for (const r of results.filter((r) => r.status === 'rejected')) {
      expect((r as PromiseRejectedResult).reason).toMatchObject({ code: 'CONFLICT' })
    }
    expect(await db.select().from(apikey).where(eq(apikey.referenceId, ctx.user.id))).toHaveLength(MAX_ACCESS_TOKENS)
  })

  it('pruneUnusedOauthClients deletes only old, unowned clients with no consent or tokens', async () => {
    const pdb = await createTestDb()
    const now = new Date('2026-11-09T12:00:00Z')
    const old = new Date(now.getTime() - 25 * 3_600_000)
    const recent = new Date(now.getTime() - 23 * 3_600_000)
    const owner = await makeUser(pdb, { role: 'lecturer' })
    const client = async (clientId: string, createdAt: Date, extra: Partial<typeof oauthClient.$inferInsert> = {}) =>
      pdb.insert(oauthClient).values({ id: crypto.randomUUID(), clientId, redirectUris: ['https://x.example/cb'], createdAt, ...extra })
    await client('unused-old', old)
    await client('unused-recent', recent)
    await client('owned-old', old, { userId: owner.id })
    await client('referenced-old', old, { referenceId: 'org-1' })
    await client('consented-old', old)
    await client('refresh-old', old)
    await client('access-old', old)
    await pdb.insert(oauthConsent).values({ id: 'c1', clientId: 'consented-old', userId: owner.id, scopes: ['clasync:read'], createdAt: old, updatedAt: old })
    await pdb.insert(oauthRefreshToken).values({
      id: 'r1', token: 'r1', clientId: 'refresh-old', userId: owner.id, expiresAt: now, createdAt: old, scopes: [],
    })
    await pdb.insert(oauthAccessToken).values({ id: 'a1', token: 'a1', clientId: 'access-old', userId: owner.id, expiresAt: now, createdAt: old, scopes: [] })

    expect(await pruneUnusedOauthClients(pdb, now)).toBe(1)
    const left = (await pdb.select({ id: oauthClient.clientId }).from(oauthClient)).map((r) => r.id).sort()
    expect(left).toEqual(['access-old', 'consented-old', 'owned-old', 'referenced-old', 'refresh-old', 'unused-recent'])
    expect(await pdb.select().from(user)).toHaveLength(1)
  })
})
