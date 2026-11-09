import { beforeAll, describe, expect, it } from 'vitest'
import type { Db } from '@/server/db'
import { rateLimit } from '@/server/db/schema'
import { createTestDb } from '@/test/db'
import { hitRateLimit, isRateLimited, pruneRateLimits } from './rate-limit'

describe('rate limit counters', () => {
  let db: Db
  const rule = { max: 3, windowMs: 60_000 }
  // 20 s into a minute window: 40 s left.
  const t0 = new Date(Date.UTC(2026, 10, 9, 10, 0, 20))
  const at = (ms: number) => new Date(t0.getTime() + ms)

  beforeAll(async () => {
    db = await createTestDb()
  })

  it('allows max hits per window, refuses the next with the seconds left, and restarts in the next window', async () => {
    for (let i = 0; i < 3; i++) expect(await hitRateLimit(db, 'k1', rule, at(i * 1000))).toEqual({ limited: false, retryAfter: 40 - i })
    expect(await hitRateLimit(db, 'k1', rule, at(5000))).toEqual({ limited: true, retryAfter: 35 })
    expect(await hitRateLimit(db, 'k1', rule, at(40_000))).toEqual({ limited: false, retryAfter: 60 })
  })

  it('counts each key on its own', async () => {
    for (let i = 0; i < 4; i++) await hitRateLimit(db, 'k2', rule, t0)
    expect((await hitRateLimit(db, 'k3', rule, t0)).limited).toBe(false)
  })

  it('isRateLimited reads without counting: limited once max hits are used, not in a later window', async () => {
    expect(await isRateLimited(db, 'k4', rule, t0)).toEqual({ limited: false, retryAfter: 40 })
    for (let i = 0; i < 2; i++) await hitRateLimit(db, 'k4', rule, t0)
    expect((await isRateLimited(db, 'k4', rule, t0)).limited).toBe(false)
    await hitRateLimit(db, 'k4', rule, t0)
    expect((await isRateLimited(db, 'k4', rule, t0)).limited).toBe(true)
    expect((await isRateLimited(db, 'k4', rule, at(40_000))).limited).toBe(false)
  })

  it('counts every concurrent hit (one atomic upsert per hit)', async () => {
    const results = await Promise.all(Array.from({ length: 10 }, () => hitRateLimit(db, 'k5', rule, t0)))
    expect(results.filter((r) => r.limited)).toHaveLength(7)
  })

  it('prunes counters whose window started more than a day ago', async () => {
    await hitRateLimit(db, 'old', rule, new Date(t0.getTime() - 2 * 86_400_000))
    await hitRateLimit(db, 'fresh', rule, t0)
    expect(await pruneRateLimits(db, at(60_000))).toBe(1)
    const keys = (await db.select({ key: rateLimit.key }).from(rateLimit)).map((r) => r.key)
    expect(keys).toContain('fresh')
    expect(keys).not.toContain('old')
  })
})
