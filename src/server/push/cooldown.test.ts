import { afterEach, beforeAll, describe, expect, it } from 'vitest'
import type { Db } from '@/server/db'
import { pushCooldown } from '@/server/db/schema'
import { createTestDb } from '@/test/db'
import { NOTES_COOLDOWN_MS, claimCooldown, forceCooldown, notesCooldownKey } from './cooldown'

describe('notes cooldown', () => {
  let db: Db
  beforeAll(async () => {
    db = await createTestDb()
  })
  afterEach(async () => {
    await db.delete(pushCooldown)
  })

  const t0 = new Date('2026-11-12T10:00:00Z')
  const key = notesCooldownKey('course-1')

  it('builds the key from the course id', () => {
    expect(key).toBe('notes:course-1')
  })

  it('first claim wins, second within 30 minutes loses', async () => {
    expect(await claimCooldown(db, key, NOTES_COOLDOWN_MS, t0)).toBe(true)
    const later = new Date(t0.getTime() + 29 * 60_000)
    expect(await claimCooldown(db, key, NOTES_COOLDOWN_MS, later)).toBe(false)
  })

  it('claims again after the cooldown', async () => {
    await claimCooldown(db, key, NOTES_COOLDOWN_MS, t0)
    const later = new Date(t0.getTime() + NOTES_COOLDOWN_MS)
    expect(await claimCooldown(db, key, NOTES_COOLDOWN_MS, later)).toBe(true)
  })

  it('two concurrent claims: exactly one wins', async () => {
    // PGlite serialises the two calls; on real Postgres the single-statement upsert is what
    // guarantees exactly one winner.
    const results = await Promise.all([
      claimCooldown(db, key, NOTES_COOLDOWN_MS, t0),
      claimCooldown(db, key, NOTES_COOLDOWN_MS, t0),
    ])
    expect(results.filter(Boolean)).toHaveLength(1)
  })

  it('force restarts the cooldown even inside it', async () => {
    await claimCooldown(db, key, NOTES_COOLDOWN_MS, t0)
    const later = new Date(t0.getTime() + 20 * 60_000)
    await forceCooldown(db, key, NOTES_COOLDOWN_MS, later)
    const after = new Date(t0.getTime() + 40 * 60_000)
    expect(await claimCooldown(db, key, NOTES_COOLDOWN_MS, after)).toBe(false)
    const end = new Date(later.getTime() + NOTES_COOLDOWN_MS)
    expect(await claimCooldown(db, key, NOTES_COOLDOWN_MS, end)).toBe(true)
  })
})
