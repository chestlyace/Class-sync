import { and, count, eq, gte, isNull, lt, sql } from 'drizzle-orm'
import type { Db } from '@/server/db'
import { whatsappMessage, whatsappMonthUsage, type WhatsAppKind } from '@/server/db/schema'
import { whatsAppConfig } from './config'

const DEFAULT_CAP = 2000
/** Alerts a student must act on right now may use the whole cap; the rest stop at 90% so these still get through. */
const URGENT_KINDS: readonly WhatsAppKind[] = ['checkinOpen', 'testStarted']

/** The UTC calendar month of `at`, as `YYYY-MM`. */
function monthKey(at: Date): string {
  return at.toISOString().slice(0, 7)
}

function monthRange(at: Date): { start: Date; end: Date } {
  const start = new Date(Date.UTC(at.getUTCFullYear(), at.getUTCMonth(), 1))
  const end = new Date(Date.UTC(at.getUTCFullYear(), at.getUTCMonth() + 1, 1))
  return { start, end }
}

/**
 * Takes one message from this month's allowance. One statement, so concurrent senders cannot
 * pass the limit: the first claim inserts the month with sent = 1, later ones add 1 only while
 * sent is below the limit. False means the cap stopped it.
 */
export async function claimSend(db: Db, kind: WhatsAppKind, at: Date, cap: number): Promise<boolean> {
  const limit = URGENT_KINDS.includes(kind) ? cap : Math.floor(cap * 0.9)
  if (limit < 1) return false
  const rows = await db
    .insert(whatsappMonthUsage)
    .values({ month: monthKey(at), sent: 1 })
    .onConflictDoUpdate({
      target: whatsappMonthUsage.month,
      set: { sent: sql`${whatsappMonthUsage.sent} + 1` },
      setWhere: sql`${whatsappMonthUsage.sent} < ${limit}`,
    })
    .returning({ month: whatsappMonthUsage.month })
  return rows.length > 0
}

/** Gives back a claimed message after the provider call failed. Never goes below zero. */
export async function releaseClaim(db: Db, at: Date): Promise<void> {
  await db
    .update(whatsappMonthUsage)
    .set({ sent: sql`greatest(${whatsappMonthUsage.sent} - 1, 0)` })
    .where(eq(whatsappMonthUsage.month, monthKey(at)))
}

/** This month's count against the cap, plus the messages the cap skipped and the ones that failed. */
export async function monthlyUsage(
  db: Db,
  at: Date,
): Promise<{ month: string; sent: number; cap: number; skippedCap: number; failed: number }> {
  const month = monthKey(at)
  const { start, end } = monthRange(at)
  const [usage] = await db.select({ sent: whatsappMonthUsage.sent }).from(whatsappMonthUsage).where(eq(whatsappMonthUsage.month, month))
  const byStatus = async (status: 'skipped_cap' | 'failed') => {
    const [row] = await db
      .select({ n: count() })
      .from(whatsappMessage)
      .where(and(eq(whatsappMessage.status, status), gte(whatsappMessage.createdAt, start), lt(whatsappMessage.createdAt, end)))
    return row?.n ?? 0
  }
  return {
    month,
    sent: usage?.sent ?? 0,
    cap: whatsAppConfig()?.cap ?? DEFAULT_CAP,
    skippedCap: await byStatus('skipped_cap'),
    failed: await byStatus('failed'),
  }
}

/** Marks that the owner was told about the cap this month. True only the first time in a month. */
export async function noteCapReached(db: Db, at: Date): Promise<boolean> {
  const rows = await db
    .insert(whatsappMonthUsage)
    .values({ month: monthKey(at), sent: 0, capMailedAt: new Date() })
    .onConflictDoUpdate({
      target: whatsappMonthUsage.month,
      set: { capMailedAt: new Date() },
      setWhere: isNull(whatsappMonthUsage.capMailedAt),
    })
    .returning({ month: whatsappMonthUsage.month })
  return rows.length > 0
}
