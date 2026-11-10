import { and, inArray, isNotNull, lt } from 'drizzle-orm'
import { db as defaultDb, type Db } from '@/server/db'
import { opsEvent, user, type OpsEventKind } from '@/server/db/schema'

const DAY_MS = 86_400_000
export const OPS_EVENT_RETENTION_DAYS = 90

/**
 * `amina@example.com` becomes `a***@example.com`; anything without an `@` becomes `***`. Health
 * events never carry a full address.
 */
export function maskEmail(email: string): string {
  const at = email.indexOf('@')
  if (at < 1) return '***'
  return `${email[0]}***${email.slice(at)}`
}

/**
 * A provider's error text for `detail`: any address in it masked, and bounded in length. Never
 * throws: a missing or non-string message (a provider can reject with anything) becomes text.
 */
export function scrubError(message: string): string {
  return String(message ?? '').replace(/[^\s@<>,;"']+@[^\s@<>,;"']+/g, (m) => maskEmail(m)).slice(0, 200)
}

/**
 * Writes one health event. It never throws: a database error is logged and swallowed, because
 * health logging must not break the action it observes. Callers keep tokens, marks, message
 * bodies and unmasked addresses out of `detail`.
 */
export async function recordOpsEvent(
  db: Db,
  e: { kind: OpsEventKind; ok: boolean; detail?: Record<string, unknown>; at?: Date },
): Promise<void> {
  try {
    await db.insert(opsEvent).values({ kind: e.kind, ok: e.ok, detail: e.detail ?? {}, ...(e.at ? { at: e.at } : {}) })
  } catch (error) {
    console.error('[ops] could not record a health event', { kind: e.kind, error })
  }
}

/** `recordOpsEvent` on the app's own database, for code (route handlers) that must not import the database layer. */
export function recordOpsEventDefault(e: Parameters<typeof recordOpsEvent>[1]): Promise<void> {
  return recordOpsEvent(defaultDb, e)
}

/** Deletes events older than 90 days and returns how many. Run from the daily cron. */
export async function pruneOpsEvents(db: Db = defaultDb, at: Date = new Date()): Promise<number> {
  const cutoff = new Date(at.getTime() - OPS_EVENT_RETENTION_DAYS * DAY_MS)
  const deleted = await db.delete(opsEvent).where(lt(opsEvent.at, cutoff)).returning({ id: opsEvent.id })
  return deleted.length
}

/**
 * Which of these addresses belong to suspended accounts: one query, returned lower-cased. A
 * suspended user gets no email at all. Addresses are compared case-insensitively: Better Auth
 * stores them lower-cased (sign-up, createUser and change-email all normalise), so the given ones
 * are lower-cased and matched as stored, which lets the unique email index serve the lookup.
 */
export async function dropSuspendedRecipients(db: Db, emails: string[]): Promise<Set<string>> {
  if (emails.length === 0) return new Set()
  const lowered = [...new Set(emails.map((e) => e.trim().toLowerCase()))]
  const rows = await db
    .select({ email: user.email })
    .from(user)
    .where(and(isNotNull(user.suspendedAt), inArray(user.email, lowered)))
  return new Set(rows.map((r) => r.email.toLowerCase()))
}
