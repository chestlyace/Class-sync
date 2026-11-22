import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { AppError } from '@/server/core/errors'
import type { Db } from '@/server/db'
import { aiUsage, rateLimit } from '@/server/db/schema'
import { createTestDb } from '@/test/db'
import { makeUser } from '@/test/factories'
import { assertCanSuggestTestMarks, TEST_SUGGEST_RATE_LIMIT, testSuggestRateLimitKey } from './limits'

describe('test correction AI limits', () => {
  let db: Db
  let lecturerId: string
  const at = new Date('2026-11-22T10:00:20Z')

  beforeAll(async () => {
    db = await createTestDb()
    lecturerId = (await makeUser(db)).id
  })
  afterEach(async () => {
    vi.unstubAllEnvs()
    await db.delete(aiUsage)
    await db.delete(rateLimit)
  })
  afterAll(async () => {
    await (db as unknown as { $client: { close?: () => Promise<void> } }).$client?.close?.()
  })

  it('uses an opaque key of ids only: no question, prompt or answer can reach the counter', () => {
    const key = testSuggestRateLimitKey(lecturerId)
    expect(key).toBe(`ai:test-suggest:${lecturerId}`)
    expect(key).not.toMatch(/osmosis|water|membrane/i)
  })

  it('refuses with reason cap before counting a burst hit when the shared monthly cap is reached', async () => {
    vi.stubEnv('AI_MONTHLY_CAP', '1')
    await db.insert(aiUsage).values({
      purpose: 'test_correction',
      lecturerId,
      model: 'm',
      ok: true,
      createdAt: new Date('2026-11-01T00:00:00Z'),
    })
    await expect(assertCanSuggestTestMarks(db, lecturerId, at)).rejects.toMatchObject({
      code: 'CONFLICT',
      details: { reason: 'cap' },
    })
    expect(await db.select().from(rateLimit)).toHaveLength(0)
  })

  it('allows max requests per window, then refuses with reason rate_limited and retryAfter seconds', async () => {
    vi.stubEnv('AI_MONTHLY_CAP', '3000')
    for (let i = 0; i < TEST_SUGGEST_RATE_LIMIT.max; i++) {
      await expect(assertCanSuggestTestMarks(db, lecturerId, at)).resolves.toBeUndefined()
    }
    const error = await assertCanSuggestTestMarks(db, lecturerId, at).catch((e: unknown) => e)
    expect(error).toBeInstanceOf(AppError)
    expect(error).toMatchObject({ code: 'CONFLICT', details: { reason: 'rate_limited' } })
    expect((error as AppError).details?.retryAfter).toBeGreaterThan(0)
    const [counter] = await db.select().from(rateLimit)
    expect(counter).toMatchObject({ key: testSuggestRateLimitKey(lecturerId), count: TEST_SUGGEST_RATE_LIMIT.max + 1 })
  })

  it('starts fresh in the next window and for another lecturer', async () => {
    vi.stubEnv('AI_MONTHLY_CAP', '3000')
    for (let i = 0; i < TEST_SUGGEST_RATE_LIMIT.max; i++) await assertCanSuggestTestMarks(db, lecturerId, at)
    const later = new Date(at.getTime() + TEST_SUGGEST_RATE_LIMIT.windowMs)
    await expect(assertCanSuggestTestMarks(db, lecturerId, later)).resolves.toBeUndefined()
    const otherLecturerId = (await makeUser(db)).id
    await expect(assertCanSuggestTestMarks(db, otherLecturerId, at)).resolves.toBeUndefined()
  })
})
