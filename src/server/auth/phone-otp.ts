import { and, count, eq, gte, ne, sql } from 'drizzle-orm'
import { isLocale, type Locale } from '@/i18n/locale'
import { now } from '@/server/core/clock'
import type { Db } from '@/server/db'
import { rateLimit, whatsappMessage } from '@/server/db/schema'
import { hitRateLimit, isRateLimited, type RateLimitRule } from '@/server/lib/rate-limit'
import { isAllowedWhatsAppNumber } from '@/server/whatsapp/config'
import { whatsAppProvider } from '@/server/whatsapp/provider'
import { buildVerificationTemplate } from '@/server/whatsapp/templates'

/**
 * Who may make Clasync send a WhatsApp code, and how often. A code costs money and can be aimed at
 * anyone's phone, so every request is counted before anything is sent:
 * - one code per number per 60 s (a sliding marker, so two codes can never land 2 s apart across a window edge);
 * - 5 codes per number per day, 5 distinct numbers per account per day, 60 per IP per hour;
 * - 200 codes a day for the whole platform (a bound on the daily bill, and on a bot swarm).
 * The per-account and platform counts come from the `whatsapp_message` rows that sending writes, since UTC midnight.
 */
const NUMBER_DAY_RULE: RateLimitRule = { max: 5, windowMs: 24 * 60 * 60 * 1000 }
const IP_RULE: RateLimitRule = { max: 60, windowMs: 60 * 60 * 1000 }
const COOLDOWN_MS = 60 * 1000
const MAX_NUMBERS_PER_ACCOUNT = 5
const MAX_CODES_PER_DAY = 200

export type CodeLimitReason = 'cooldown' | 'number_day' | 'account_numbers' | 'ip' | 'global'
export type CodeLimitResult = { ok: true } | { ok: false; reason: CodeLimitReason; retryAfter: number }
export type CodeLimitInput = { phone: string; userId: string | null; ip: string | null; at?: Date }

/** Thrown by `hitCodeLimits` when a concurrent request took the number's 60-second slot first. */
export class CodeLimitedError extends Error {
  constructor(
    readonly reason: CodeLimitReason,
    readonly retryAfter: number,
  ) {
    super(`WhatsApp code limited: ${reason}`)
  }
}

const numKey = (phone: string) => `otp:num:${phone}`
const dayKey = (phone: string) => `otp:numday:${phone}`
const ipKey = (ip: string | null) => `otp:ip:${ip ?? 'unknown'}`

function utcMidnight(at: Date): Date {
  return new Date(Date.UTC(at.getUTCFullYear(), at.getUTCMonth(), at.getUTCDate()))
}

/** Seconds until the next UTC midnight, at least 1. */
function untilMidnight(at: Date): number {
  return Math.max(1, Math.ceil((utcMidnight(at).getTime() + 86_400_000 - at.getTime()) / 1000))
}

/** Codes sent so far today (UTC), across the platform. */
async function codesSentToday(db: Db, at: Date): Promise<number> {
  const [row] = await db
    .select({ n: count() })
    .from(whatsappMessage)
    .where(and(eq(whatsappMessage.kind, 'verificationCode'), gte(whatsappMessage.createdAt, utcMidnight(at))))
  return row?.n ?? 0
}

/** Whether the platform's daily code budget still has room. Sign-up pages offer WhatsApp only while it does. */
export async function codesAvailableToday(db: Db, at: Date = now()): Promise<boolean> {
  return (await codesSentToday(db, at)) < MAX_CODES_PER_DAY
}

/** Reads every limit and says which one (if any) stops this request. Counts nothing: see `hitCodeLimits`. */
export async function checkCodeLimits(db: Db, input: CodeLimitInput): Promise<CodeLimitResult> {
  const at = input.at ?? now()

  const [last] = await db
    .select({ windowStart: rateLimit.windowStart })
    .from(rateLimit)
    .where(and(eq(rateLimit.key, numKey(input.phone)), gte(rateLimit.windowStart, new Date(at.getTime() - COOLDOWN_MS + 1))))
  if (last) {
    return { ok: false, reason: 'cooldown', retryAfter: Math.max(1, Math.ceil((last.windowStart.getTime() + COOLDOWN_MS - at.getTime()) / 1000)) }
  }

  const day = await isRateLimited(db, dayKey(input.phone), NUMBER_DAY_RULE, at)
  if (day.limited) return { ok: false, reason: 'number_day', retryAfter: day.retryAfter }

  if (input.userId) {
    // Other numbers this account already sent to today: a number it already used does not count again.
    const phoneOf = sql`split_part(${whatsappMessage.eventKey}, ':', 2)`
    const [row] = await db
      .select({ n: sql<number>`count(distinct ${phoneOf})`.mapWith(Number) })
      .from(whatsappMessage)
      .where(
        and(
          eq(whatsappMessage.userId, input.userId),
          eq(whatsappMessage.kind, 'verificationCode'),
          gte(whatsappMessage.createdAt, utcMidnight(at)),
          ne(phoneOf, input.phone),
        ),
      )
    if ((row?.n ?? 0) >= MAX_NUMBERS_PER_ACCOUNT) return { ok: false, reason: 'account_numbers', retryAfter: untilMidnight(at) }
  }

  const ip = await isRateLimited(db, ipKey(input.ip), IP_RULE, at)
  if (ip.limited) return { ok: false, reason: 'ip', retryAfter: ip.retryAfter }

  if ((await codesSentToday(db, at)) >= MAX_CODES_PER_DAY) return { ok: false, reason: 'global', retryAfter: untilMidnight(at) }

  return { ok: true }
}

/**
 * Counts one request against the per-number and per-IP limits. The 60-second slot is taken in one
 * statement, so of two simultaneous requests for a number only one gets it: the other throws
 * `CodeLimitedError` (and counts nothing). Call it right after `checkCodeLimits` returned ok.
 */
export async function hitCodeLimits(db: Db, input: CodeLimitInput): Promise<void> {
  const at = input.at ?? now()
  const claimed = await db
    .insert(rateLimit)
    .values({ key: numKey(input.phone), windowStart: at, count: 1 })
    .onConflictDoUpdate({
      target: rateLimit.key,
      set: { windowStart: at, count: 1 },
      setWhere: sql`${rateLimit.windowStart} <= ${new Date(at.getTime() - COOLDOWN_MS)}`,
    })
    .returning({ key: rateLimit.key })
  if (claimed.length === 0) throw new CodeLimitedError('cooldown', COOLDOWN_MS / 1000)
  await hitRateLimit(db, dayKey(input.phone), NUMBER_DAY_RULE, at)
  await hitRateLimit(db, ipKey(input.ip), IP_RULE, at)
}

export type SendVerificationCodeInput = {
  phone: string
  code: string
  locale: Locale
  /** The signed-in account that asked (sign-up verification), else null. Counted toward its distinct numbers per day. */
  userId: string | null
  at?: Date
}

/**
 * Sends the code as the `verification_code` template and records one `whatsapp_message` row (kind
 * `verificationCode`). Numbers outside WHATSAPP_ALLOWLIST get nothing. Never touches the monthly alert
 * usage (a code is not an alert) and never throws: a failed send is recorded as `failed`, because the
 * caller must answer the same whether or not an account exists.
 */
export async function sendVerificationCode(db: Db, input: SendVerificationCodeInput): Promise<void> {
  if (!isAllowedWhatsAppNumber(input.phone)) return
  const provider = whatsAppProvider()
  if (!provider) return
  const at = input.at ?? now()
  const locale: Locale = isLocale(input.locale) ? input.locale : 'en'
  // The row first, as 'pending': it counts toward the limits even if the process dies mid-send.
  const [row] = await db
    .insert(whatsappMessage)
    .values({
      userId: input.userId,
      kind: 'verificationCode',
      eventKey: `otp:${input.phone}:${at.toISOString()}`,
      template: 'verification_code',
      status: 'pending',
      createdAt: at,
      updatedAt: at,
    })
    .returning({ id: whatsappMessage.id })
  try {
    const { messageId } = await provider.sendTemplate(input.phone, buildVerificationTemplate(input.code, locale))
    await db.update(whatsappMessage).set({ status: 'sent', providerMessageId: messageId, updatedAt: now() }).where(eq(whatsappMessage.id, row.id))
  } catch (error) {
    console.error('[auth] WhatsApp verification code failed', error)
    const reason = error instanceof Error ? error.message : String(error)
    await db
      .update(whatsappMessage)
      .set({ status: 'failed', error: reason.slice(0, 500), updatedAt: now() })
      .where(eq(whatsappMessage.id, row.id))
      .catch((cleanupError) => console.error('[auth] could not record a failed WhatsApp code', cleanupError))
  }
}
