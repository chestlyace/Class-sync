import { describe, expect, it } from 'vitest'
import { whatsappMessage, whatsappMonthUsage } from '@/server/db/schema'
import { createTestDb } from '@/test/db'
import { claimSend, monthlyUsage, noteCapReached, releaseClaim } from './cap'

const MAY = new Date('2026-05-10T12:00:00Z')

describe('claimSend', () => {
  it('keeps the last 10 percent for urgent kinds', async () => {
    const db = await createTestDb()
    for (let i = 0; i < 9; i++) expect(await claimSend(db, 'resultsReleased', MAY, 10)).toBe(true)
    expect(await claimSend(db, 'resultsReleased', MAY, 10)).toBe(false)
    expect(await claimSend(db, 'checkinOpen', MAY, 10)).toBe(true)
    expect(await claimSend(db, 'checkinOpen', MAY, 10)).toBe(false)
    expect(await claimSend(db, 'testStarted', MAY, 10)).toBe(false)
    expect(await claimSend(db, 'assignmentPublished', MAY, 10)).toBe(false)
  })

  it('lets exactly cap of 20 concurrent claims through', async () => {
    const db = await createTestDb()
    const results = await Promise.all(Array.from({ length: 20 }, () => claimSend(db, 'checkinOpen', MAY, 10)))
    expect(results.filter(Boolean)).toHaveLength(10)
    const [row] = await db.select().from(whatsappMonthUsage)
    expect(row.sent).toBe(10)
  })

  it('refuses the first claim when the limit is below one', async () => {
    const db = await createTestDb()
    expect(await claimSend(db, 'resultsReleased', MAY, 1)).toBe(false)
    expect(await db.select().from(whatsappMonthUsage)).toHaveLength(0)
    expect(await claimSend(db, 'checkinOpen', MAY, 1)).toBe(true)
  })

  it('starts a new month at 00:00 UTC on the 1st', async () => {
    const db = await createTestDb()
    expect(await claimSend(db, 'checkinOpen', new Date('2026-05-31T23:59:59Z'), 1)).toBe(true)
    expect(await claimSend(db, 'checkinOpen', new Date('2026-05-31T23:59:59Z'), 1)).toBe(false)
    expect(await claimSend(db, 'checkinOpen', new Date('2026-06-01T00:00:00Z'), 1)).toBe(true)
    const rows = await db.select().from(whatsappMonthUsage)
    expect(rows.map((r) => r.month).sort()).toEqual(['2026-05', '2026-06'])
  })
})

describe('releaseClaim', () => {
  it('gives a slot back and never goes below zero', async () => {
    const db = await createTestDb()
    await claimSend(db, 'checkinOpen', MAY, 1)
    expect(await claimSend(db, 'checkinOpen', MAY, 1)).toBe(false)
    await releaseClaim(db, MAY)
    expect(await claimSend(db, 'checkinOpen', MAY, 1)).toBe(true)
    await releaseClaim(db, MAY)
    await releaseClaim(db, MAY)
    const [row] = await db.select().from(whatsappMonthUsage)
    expect(row.sent).toBe(0)
  })

  it('does nothing when the month has no row', async () => {
    const db = await createTestDb()
    await releaseClaim(db, MAY)
    expect(await db.select().from(whatsappMonthUsage)).toHaveLength(0)
  })
})

describe('noteCapReached', () => {
  it('is true once per month', async () => {
    const db = await createTestDb()
    await claimSend(db, 'checkinOpen', MAY, 1)
    expect(await noteCapReached(db, MAY)).toBe(true)
    expect(await noteCapReached(db, MAY)).toBe(false)
    expect(await noteCapReached(db, new Date('2026-06-02T00:00:00Z'))).toBe(true)
  })
})

describe('monthlyUsage', () => {
  it('reports sent, cap and this month skipped and failed messages', async () => {
    const db = await createTestDb()
    await claimSend(db, 'checkinOpen', MAY, 10)
    await claimSend(db, 'checkinOpen', MAY, 10)
    const row = (status: 'skipped_cap' | 'failed' | 'sent', key: string, createdAt: Date) => ({
      kind: 'checkinOpen' as const,
      eventKey: key,
      template: 't',
      status,
      createdAt,
    })
    await db.insert(whatsappMessage).values([
      row('skipped_cap', 'a', new Date('2026-05-01T00:00:00Z')),
      row('skipped_cap', 'b', new Date('2026-05-31T23:59:59Z')),
      row('skipped_cap', 'c', new Date('2026-04-30T23:59:59Z')),
      row('skipped_cap', 'd', new Date('2026-06-01T00:00:00Z')),
      row('failed', 'e', new Date('2026-05-15T00:00:00Z')),
      row('sent', 'f', new Date('2026-05-15T00:00:00Z')),
    ])
    const usage = await monthlyUsage(db, MAY)
    expect(usage).toMatchObject({ month: '2026-05', sent: 2, skippedCap: 2, failed: 1 })
    expect(usage.cap).toBe(2000)
  })

  it('is zero for a month with no row', async () => {
    const db = await createTestDb()
    expect(await monthlyUsage(db, MAY)).toMatchObject({ month: '2026-05', sent: 0, skippedCap: 0, failed: 0 })
  })
})
