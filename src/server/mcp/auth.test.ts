import { eq } from 'drizzle-orm'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import { config, setConfigForTests } from '@/server/core/config'
import type { Db } from '@/server/db'
import { apikey } from '@/server/db/schema'
import { createTestDb } from '@/test/db'
import { ctxFor, makeUser } from '@/test/factories'
import { resolveMcpCaller, type McpAuthDeps, type McpCaller } from './auth'
import { createAccessToken, disconnectApp, type AuthInstance } from './connections'
import { createTestAuth, registerClient, runOAuthFlow, signUp, TEST_ORIGIN } from '@/test/mcp-oauth'

function mcpRequest(token?: string) {
  return new Request(`${TEST_ORIGIN}/api/mcp`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: '{}',
  })
}

async function expectChallenge(res: McpCaller | Response, invalidToken: boolean) {
  expect(res).toBeInstanceOf(Response)
  const r = res as Response
  expect(r.status).toBe(401)
  const header = r.headers.get('www-authenticate') ?? ''
  expect(header).toContain(`resource_metadata="${TEST_ORIGIN}/.well-known/oauth-protected-resource/api/mcp"`)
  expect(header.includes('error="invalid_token"')).toBe(invalidToken)
  expect(await r.json()).toMatchObject({ jsonrpc: '2.0', error: { code: -32000 } })
}

async function expectForbidden(res: McpCaller | Response, message: string) {
  expect(res).toBeInstanceOf(Response)
  expect((res as Response).status).toBe(403)
  expect(((await (res as Response).json()) as { error: { message: string } }).error.message).toBe(message)
}

describe('resolveMcpCaller', () => {
  let db: Db
  let auth: AuthInstance
  let deps: McpAuthDeps
  const original = config.requireEmailVerification

  beforeAll(async () => {
    setConfigForTests({ requireEmailVerification: false })
    db = await createTestDb()
    auth = createTestAuth(db)
    deps = { auth, db, origin: TEST_ORIGIN }
  })
  afterEach(() => setConfigForTests({ requireEmailVerification: false }))
  afterAll(() => setConfigForTests({ requireEmailVerification: original }))

  it('answers 401 with the resource metadata challenge without a token', async () => {
    await expectChallenge(await resolveMcpCaller(mcpRequest(), deps), false)
    const basic = new Request(`${TEST_ORIGIN}/api/mcp`, { method: 'POST', headers: { authorization: 'Basic abc' } })
    await expectChallenge(await resolveMcpCaller(basic, deps), false)
  })

  it('answers 401 for a garbage token, API key or JWT', async () => {
    await expectChallenge(await resolveMcpCaller(mcpRequest('garbage'), deps), true)
    await expectChallenge(await resolveMcpCaller(mcpRequest(`cls_${'a'.repeat(64)}`), deps), true)
    await expectChallenge(await resolveMcpCaller(mcpRequest('eyJhbGciOiJub25lIn0.eyJzdWIiOiJ4In0.'), deps), true)
  })

  describe('personal access tokens', () => {
    it('a valid key acts as the lecturer with both scopes', async () => {
      const lecturer = ctxFor(db, await makeUser(db, { role: 'lecturer', name: 'Dr Ngono' }))
      const { id, key } = await createAccessToken(lecturer, { name: 'CLI', expiresInDays: 30 }, auth)
      const caller = await resolveMcpCaller(mcpRequest(key), deps)
      expect(caller).not.toBeInstanceOf(Response)
      const c = caller as McpCaller
      expect(c.ctx.user).toEqual(lecturer.user)
      expect(c.ctx.db).toBe(db)
      expect(c.scopes).toEqual(['clasync:read', 'clasync:write'])
      expect(c.clientId).toBe(`token:${id}`)
    })

    it('a revoked key gets 401', async () => {
      const lecturer = ctxFor(db, await makeUser(db, { role: 'lecturer' }))
      const { id, key } = await createAccessToken(lecturer, { name: 'CLI', expiresInDays: 30 }, auth)
      await db.update(apikey).set({ enabled: false }).where(eq(apikey.id, id))
      await expectChallenge(await resolveMcpCaller(mcpRequest(key), deps), true)
    })

    it('an expired key gets 401', async () => {
      const lecturer = ctxFor(db, await makeUser(db, { role: 'lecturer' }))
      const { id, key } = await createAccessToken(lecturer, { name: 'CLI', expiresInDays: 30 }, auth)
      await db.update(apikey).set({ expiresAt: new Date(Date.now() - 1000) }).where(eq(apikey.id, id))
      await expectChallenge(await resolveMcpCaller(mcpRequest(key), deps), true)
    })

    it("a student's key gets 403", async () => {
      const student = await makeUser(db, { role: 'student' })
      const { key } = await auth.api.createApiKey({ body: { name: 'sneaky', userId: student.id } })
      await expectForbidden(await resolveMcpCaller(mcpRequest(key), deps), "Clasync's assistant connection is for lecturers")
    })

    it('an unverified lecturer gets 403 while verification is required', async () => {
      const lecturer = await makeUser(db, { role: 'lecturer', emailVerified: false })
      const { key } = await auth.api.createApiKey({ body: { name: 'early', userId: lecturer.id } })
      setConfigForTests({ requireEmailVerification: true })
      await expectForbidden(await resolveMcpCaller(mcpRequest(key), deps), 'Verify your email address in Clasync first')
    })
  })

  describe('OAuth access tokens', () => {
    it('a token from the authorization flow acts as the user with its scopes; disconnecting revokes it', async () => {
      const clientId = await registerClient(auth)
      const { cookie, userId } = await signUp(auth, 'lecturer', `oauth-lec-${crypto.randomUUID()}@example.com`)
      const { tokens } = await runOAuthFlow(auth, { clientId, cookie })
      expect(tokens.refresh_token).toBeTruthy()

      const caller = (await resolveMcpCaller(mcpRequest(tokens.access_token), deps)) as McpCaller
      expect(caller).not.toBeInstanceOf(Response)
      expect(caller.ctx.user).toMatchObject({ id: userId, role: 'lecturer' })
      expect(caller.scopes).toEqual(['clasync:read', 'clasync:write'])
      expect(caller.clientId).toBe(clientId)

      await disconnectApp(caller.ctx, clientId)
      await expectChallenge(await resolveMcpCaller(mcpRequest(tokens.access_token), deps), true)
    })

    it('carries only the scopes granted', async () => {
      const clientId = await registerClient(auth)
      const { cookie } = await signUp(auth, 'lecturer', `oauth-read-${crypto.randomUUID()}@example.com`)
      const { tokens } = await runOAuthFlow(auth, { clientId, cookie, scope: 'openid clasync:read' })
      const caller = (await resolveMcpCaller(mcpRequest(tokens.access_token), deps)) as McpCaller
      expect(caller.scopes).toEqual(['clasync:read'])
    })

    it('an opaque token (no resource requested) gets 401', async () => {
      const clientId = await registerClient(auth)
      const { cookie } = await signUp(auth, 'lecturer', `oauth-opaque-${crypto.randomUUID()}@example.com`)
      const { tokens } = await runOAuthFlow(auth, { clientId, cookie, resource: null })
      expect(tokens.access_token.split('.')).not.toHaveLength(3)
      await expectChallenge(await resolveMcpCaller(mcpRequest(tokens.access_token), deps), true)
    })

    it('a token for another resource origin gets 401', async () => {
      const clientId = await registerClient(auth)
      const { cookie } = await signUp(auth, 'lecturer', `oauth-aud-${crypto.randomUUID()}@example.com`)
      const { tokens } = await runOAuthFlow(auth, { clientId, cookie })
      const elsewhere = { ...deps, origin: 'https://clasync.example' }
      const res = (await resolveMcpCaller(mcpRequest(tokens.access_token), elsewhere)) as Response
      expect(res.status).toBe(401)
      expect(res.headers.get('www-authenticate')).toContain('error="invalid_token"')
    })

    it('a student cannot get a token: allowing at the consent step is refused', async () => {
      const clientId = await registerClient(auth)
      const { cookie } = await signUp(auth, 'student', `oauth-stu-${crypto.randomUUID()}@example.com`)
      await expect(runOAuthFlow(auth, { clientId, cookie })).rejects.toThrow(/consent failed: 403/)
    })
  })
})
