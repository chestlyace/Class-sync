import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { Db } from '@/server/db'
import { aiUsage } from '@/server/db/schema'
import { createTestDb } from '@/test/db'
import { makeUser } from '@/test/factories'
import { aiCallsThisMonth, aiCapReached, recordAiUsage } from './usage'

describe('AI usage log', () => {
  let db: Db
  let lecturerId: string
  const row = { purpose: 'assignment_marking' as const, submissionId: null, model: 'm', inputTokens: 10, outputTokens: 5, ok: true }

  beforeAll(async () => {
    db = await createTestDb()
    lecturerId = (await makeUser(db)).id
  })
  afterAll(async () => {
    await (db as unknown as { $client: { close?: () => Promise<void> } }).$client?.close?.()
  })

  it('records a row', async () => {
    await recordAiUsage(db, { ...row, lecturerId, inputTokens: 123, outputTokens: 45, ok: false })
    const rows = await db.select().from(aiUsage)
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ lecturerId, inputTokens: 123, outputTokens: 45, ok: false, purpose: 'assignment_marking' })
    await db.delete(aiUsage)
  })

  it('counts only the UTC calendar month of the given date', async () => {
    await db.insert(aiUsage).values([
      { ...row, lecturerId, createdAt: new Date('2026-10-31T23:59:59Z') },
      { ...row, lecturerId, createdAt: new Date('2026-11-01T00:00:00Z') },
      { ...row, lecturerId, createdAt: new Date('2026-12-01T00:00:00Z') },
    ])
    expect(await aiCallsThisMonth(db, new Date('2026-11-18T10:00:00Z'))).toBe(1)
    expect(await aiCallsThisMonth(db, new Date('2026-10-02T10:00:00Z'))).toBe(1)
    expect(await aiCallsThisMonth(db, new Date('2026-09-02T10:00:00Z'))).toBe(0)
  })

  it('reports the cap as reached when the count equals it', async () => {
    const at = new Date('2026-11-18T10:00:00Z')
    expect(await aiCapReached(db, at, 2)).toBe(false)
    expect(await aiCapReached(db, at, 1)).toBe(true)
    expect(await aiCapReached(db, at, 0)).toBe(true)
  })
})
