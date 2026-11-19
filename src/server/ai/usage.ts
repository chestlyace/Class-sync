import { and, gte, lt, sql } from 'drizzle-orm'
import type { Db } from '@/server/db'
import { aiUsage, type AiUsagePurpose } from '@/server/db/schema'

export type AiUsageRow = {
  purpose: AiUsagePurpose
  lecturerId: string
  submissionId: string | null
  model: string
  inputTokens: number
  outputTokens: number
  ok: boolean
}

/** Logs one model call Clasync pays for (failed calls too, since they can still be billed). */
export async function recordAiUsage(db: Db, row: AiUsageRow): Promise<void> {
  await db.insert(aiUsage).values(row)
}

/** Number of logged calls in the UTC calendar month that contains `at`. */
export async function aiCallsThisMonth(db: Db, at: Date): Promise<number> {
  const start = new Date(Date.UTC(at.getUTCFullYear(), at.getUTCMonth(), 1))
  const next = new Date(Date.UTC(at.getUTCFullYear(), at.getUTCMonth() + 1, 1))
  const [row] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(aiUsage)
    .where(and(gte(aiUsage.createdAt, start), lt(aiUsage.createdAt, next)))
  return row?.n ?? 0
}

export async function aiCapReached(db: Db, at: Date, cap: number): Promise<boolean> {
  return (await aiCallsThisMonth(db, at)) >= cap
}
