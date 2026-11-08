import { eq } from 'drizzle-orm'
import { afterEach, beforeAll, describe, expect, it } from 'vitest'
import { config, setConfigForTests } from '@/server/core/config'
import type { Db } from '@/server/db'
import { apikey, oauthAccessToken, oauthClient, oauthConsent, oauthRefreshToken } from '@/server/db/schema'
import { createTestDb } from '@/test/db'
import { ctxFor, makeUser } from '@/test/factories'
import {
  createAccessToken,
  disconnectApp,
  getConsentClient,
  listAccessTokens,
  listConnectedApps,
  MAX_ACCESS_TOKENS,
  revokeAccessToken,
  type AuthInstance,
} from './connections'
import { createTestAuth } from '@/test/mcp-oauth'

describe('mcp connections service', () => {
  let db: Db
  let auth: AuthInstance
  const original = config.requireEmailVerification

  beforeAll(async () => {
    db = await createTestDb()
    auth = createTestAuth(db)
  })
  afterEach(async () => {
    setConfigForTests({ requireEmailVerification: original })
    await db.delete(apikey)
    await db.delete(oauthConsent)
    await db.delete(oauthClient)
  })

  const lecturer = async () => ctxFor(db, await makeUser(db, { role: 'lecturer' }))
  const student = async () => ctxFor(db, await makeUser(db, { role: 'student' }))

  async function insertClient(clientId: string, extra: Partial<typeof oauthClient.$inferInsert> = {}) {
    await db.insert(oauthClient).values({
      id: crypto.randomUUID(),
      clientId,
      redirectUris: ['https://claude.ai/api/mcp/auth_callback'],
      name: 'Claude',
      icon: 'https://claude.ai/icon.png',
      uri: 'https://claude.ai',
      createdAt: new Date(),
      updatedAt: new Date(),
      ...extra,
    })
  }

  describe('access tokens', () => {
    it('creates a cls_ token shown once, listed by name and first characters', async () => {
      const ctx = await lecturer()
      const { id, key } = await createAccessToken(ctx, { name: '  Laptop CLI ', expiresInDays: 90 }, auth)
      expect(key).toMatch(/^cls_[A-Za-z0-9]{64}$/)
      const list = await listAccessTokens(ctx)
      expect(list).toHaveLength(1)
      expect(list[0]).toMatchObject({ id, name: 'Laptop CLI', lastUsedAt: null })
      expect(list[0].start).toBe(key.slice(0, 8))
      const days = (list[0].expiresAt!.getTime() - list[0].createdAt.getTime()) / 86_400_000
      expect(Math.round(days)).toBe(90)
      // Only the hash is stored.
      const [row] = await db.select({ key: apikey.key }).from(apikey).where(eq(apikey.id, id))
      expect(row.key).not.toBe(key)
      expect((await auth.api.verifyApiKey({ body: { key } })).valid).toBe(true)
    })

    it('supports no expiry', async () => {
      const ctx = await lecturer()
      await createAccessToken(ctx, { name: 'Forever', expiresInDays: null }, auth)
      expect((await listAccessTokens(ctx))[0].expiresAt).toBeNull()
    })

    it('validates the name and the expiry', async () => {
      const ctx = await lecturer()
      await expect(createAccessToken(ctx, { name: '   ', expiresInDays: 30 }, auth)).rejects.toMatchObject({ code: 'VALIDATION' })
      await expect(createAccessToken(ctx, { name: 'x'.repeat(61), expiresInDays: 30 }, auth)).rejects.toMatchObject({ code: 'VALIDATION' })
      await expect(
        createAccessToken(ctx, { name: 'ok', expiresInDays: 7 as unknown as 30 }, auth),
      ).rejects.toMatchObject({ code: 'VALIDATION' })
      expect(await createAccessToken(ctx, { name: 'x'.repeat(60), expiresInDays: 30 }, auth)).toHaveProperty('key')
    })

    it(`allows at most ${MAX_ACCESS_TOKENS} active tokens; a revoked one frees a slot`, async () => {
      const ctx = await lecturer()
      const ids: string[] = []
      for (let i = 0; i < MAX_ACCESS_TOKENS; i++) ids.push((await createAccessToken(ctx, { name: `t${i}`, expiresInDays: 30 }, auth)).id)
      await expect(createAccessToken(ctx, { name: 'one more', expiresInDays: 30 }, auth)).rejects.toMatchObject({ code: 'CONFLICT' })
      await revokeAccessToken(ctx, ids[0], auth)
      await expect(createAccessToken(ctx, { name: 'one more', expiresInDays: 30 }, auth)).resolves.toHaveProperty('key')
    })

    it('revoking hides the token and makes it invalid; another user gets FORBIDDEN', async () => {
      const owner = await lecturer()
      const other = await lecturer()
      const { id, key } = await createAccessToken(owner, { name: 'CLI', expiresInDays: 30 }, auth)
      await expect(revokeAccessToken(other, id, auth)).rejects.toMatchObject({ code: 'FORBIDDEN' })
      await expect(revokeAccessToken(other, 'no-such-id', auth)).rejects.toMatchObject({ code: 'FORBIDDEN' })
      expect(await listAccessTokens(other)).toEqual([])
      await revokeAccessToken(owner, id, auth)
      expect(await listAccessTokens(owner)).toEqual([])
      expect((await auth.api.verifyApiKey({ body: { key } })).valid).toBe(false)
    })

    it('is for verified lecturers only', async () => {
      const s = await student()
      await expect(createAccessToken(s, { name: 'x', expiresInDays: 30 }, auth)).rejects.toMatchObject({ code: 'FORBIDDEN' })
      await expect(listAccessTokens(s)).rejects.toMatchObject({ code: 'FORBIDDEN' })
      setConfigForTests({ requireEmailVerification: true })
      const unverified = ctxFor(db, await makeUser(db, { role: 'lecturer', emailVerified: false }))
      await expect(createAccessToken(unverified, { name: 'x', expiresInDays: 30 }, auth)).rejects.toMatchObject({
        code: 'EMAIL_UNVERIFIED',
      })
    })
  })

  describe('connected apps', () => {
    it('lists the consents of this user with the client, and disconnect removes consent and tokens', async () => {
      const ctx = await lecturer()
      const other = await lecturer()
      await insertClient('client-a')
      const now = new Date()
      for (const u of [ctx.user.id, other.user.id]) {
        await db.insert(oauthConsent).values({
          id: crypto.randomUUID(),
          clientId: 'client-a',
          userId: u,
          scopes: ['openid', 'clasync:read'],
          createdAt: now,
          updatedAt: now,
        })
        const refreshId = crypto.randomUUID()
        await db.insert(oauthRefreshToken).values({
          id: refreshId,
          token: `r-${u}`,
          clientId: 'client-a',
          userId: u,
          expiresAt: new Date(Date.now() + 86_400_000),
          createdAt: now,
          scopes: ['clasync:read'],
        })
        await db.insert(oauthAccessToken).values({
          id: crypto.randomUUID(),
          token: `a-${u}`,
          clientId: 'client-a',
          userId: u,
          refreshId,
          expiresAt: new Date(Date.now() + 3_600_000),
          createdAt: now,
          scopes: ['clasync:read'],
        })
      }
      expect(await listConnectedApps(ctx)).toEqual([
        {
          clientId: 'client-a',
          name: 'Claude',
          icon: 'https://claude.ai/icon.png',
          uri: 'https://claude.ai',
          scopes: ['openid', 'clasync:read'],
          connectedAt: now,
        },
      ])
      await disconnectApp(ctx, 'client-a')
      expect(await listConnectedApps(ctx)).toEqual([])
      expect(await db.select().from(oauthRefreshToken).where(eq(oauthRefreshToken.userId, ctx.user.id))).toEqual([])
      expect(await db.select().from(oauthAccessToken).where(eq(oauthAccessToken.userId, ctx.user.id))).toEqual([])
      // The other lecturer's connection is untouched.
      expect(await listConnectedApps(other)).toHaveLength(1)
      expect(await db.select().from(oauthRefreshToken).where(eq(oauthRefreshToken.userId, other.user.id))).toHaveLength(1)
      await expect(disconnectApp(ctx, 'client-a')).rejects.toMatchObject({ code: 'FORBIDDEN' })
    })

    it('getConsentClient returns the client, hides non-https images, and null for unknown or disabled', async () => {
      await insertClient('client-b', { icon: 'http://insecure.example/icon.png', uri: 'javascript:alert(1)' })
      await insertClient('client-c', { disabled: true })
      expect(await getConsentClient('client-b', db)).toEqual({ clientId: 'client-b', name: 'Claude', icon: null, uri: null })
      expect(await getConsentClient('client-c', db)).toBeNull()
      expect(await getConsentClient('nope', db)).toBeNull()
      expect(await getConsentClient('', db)).toBeNull()
    })
  })
})
