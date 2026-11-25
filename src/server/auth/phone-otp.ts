import { and, count, eq, gte, ne, sql } from 'drizzle-orm'
import { isLocale, type Locale } from '@/i18n/locale'
import { now } from '@/server/core/clock'
import { isAccountVerified } from '@/server/core/guards'
import type { Db } from '@/server/db'
import { rateLimit, user, whatsappMessage } from '@/server/db/schema'
import { hitRateLimit, isRateLimited, type RateLimitRule } from '@/server/lib/rate-limit'
import { isAllowedWhatsAppNumber } from '@/server/whatsapp/config'
import { whatsAppProvider } from '@/server/whatsapp/provider'
import { buildVerificationTemplate } from '@/server/whatsapp/templates'

/**
 * Who may make Clasync send a WhatsApp code, and how often. A code costs money and can be aimed at
 * anyone's phone, so every request is counted before anything is sent:
 * - one code per number per 60 s (a sliding marker, so two codes can never land 2 s apart across a window edge);
 * - 5 codes per number per day, 60 per IP per hour;
 * - distinct numbers per account per day: 5 for a verified account, 2 for one that is not verified yet (a free
 *   sign-up must not be a cheap way to spend the day's budget);
 * - per day for the whole platform (a bound on the daily bill, and on a bot swarm): 100 verification codes and,
 *   separately, 50 password-reset codes, so signed-in accounts spending the first can never hide the second.
 * Sign-up verification and password reset have their own per-number limits and their own daily budget, so one
 * cannot block the other; the IP limit is shared. Every limit is claimed in one transaction by `hitCodeLimits`, before the
 * plugin runs (the send itself happens later, in the background), so parallel requests cannot all slip past a check.
 */
const NUMBER_DAY_RULE: RateLimitRule = { max: 5, windowMs: 24 * 60 * 60 * 1000 }
const IP_RULE: RateLimitRule = { max: 60, windowMs: 60 * 60 * 1000 }
const COOLDOWN_MS = 60 * 1000
const MAX_NUMBERS_PER_VERIFIED_ACCOUNT = 5
const MAX_NUMBERS_PER_UNVERIFIED_ACCOUNT = 2
/** The platform's daily budget of codes, per purpose. */
const MAX_CODES_PER_DAY: Record<CodePurpose, number> = { verify: 100, reset: 50 }

export type CodeLimitReason = 'cooldown' | 'number_day' | 'account_numbers' | 'ip' | 'global'
export type CodeLimitResult = { ok: true } | { ok: false; reason: CodeLimitReason; retryAfter: number }
/** `verify` (sign-up, the default) or `reset` (password reset): they count against separate per-number limits. */
export type CodePurpose = 'verify' | 'reset'
export type CodeLimitInput = { phone: string; userId: string | null; ip: string | null; purpose?: CodePurpose; at?: Date }

/** Thrown by `hitCodeLimits` when a limit was already used up by the time it claimed it. */
export class CodeLimitedError extends Error {
  constructor(
    readonly reason: CodeLimitReason,
    readonly retryAfter: number,
  ) {
    super(`WhatsApp code limited: ${reason}`)
  }
}

const purposePrefix = (purpose: CodePurpose | undefined) => (purpose === 'reset' ? 'reset:' : '')
const numKey = (phone: string, purpose?: CodePurpose) => `otp:num:${purposePrefix(purpose)}${phone}`
const dayKey = (phone: string, purpose?: CodePurpose) => `otp:numday:${purposePrefix(purpose)}${phone}`
const ipKey = (ip: string | null) => `otp:ip:${ip ?? 'unknown'}`
const utcDay = (at: Date) => at.toISOString().slice(0, 10)
const globalKey = (at: Date, purpose: CodePurpose) => `otp:global:${purpose}:${utcDay(at)}`
const accountPrefix = (userId: string, at: Date) => `otp:acct:${userId}:${utcDay(at)}:`

function utcMidnight(at: Date): Date {
  return new Date(Date.UTC(at.getUTCFullYear(), at.getUTCMonth(), at.getUTCDate()))
}

/** Seconds until the next UTC midnight, at least 1. */
function untilMidnight(at: Date): number {
  return Math.max(1, Math.ceil((utcMidnight(at).getTime() + 86_400_000 - at.getTime()) / 1000))
}

/** Codes of one purpose claimed so far today (UTC), across the platform. */
async function codesClaimedToday(db: Db, at: Date, purpose: CodePurpose): Promise<number> {
  const [row] = await db.select({ n: rateLimit.count }).from(rateLimit).where(eq(rateLimit.key, globalKey(at, purpose)))
  return row?.n ?? 0
}

/** Whether today's budget of verification codes still has room. Sign-up and Settings offer WhatsApp only while it does. */
export async function codesAvailableToday(db: Db, at: Date = now()): Promise<boolean> {
  return (await codesClaimedToday(db, at, 'verify')) < MAX_CODES_PER_DAY.verify
}

/** Whether today's budget of password-reset codes still has room. "Forgot password" offers WhatsApp only while it does. */
export async function resetCodesAvailableToday(db: Db, at: Date = now()): Promise<boolean> {
  return (await codesClaimedToday(db, at, 'reset')) < MAX_CODES_PER_DAY.reset
}

/** How many distinct numbers this account may send codes to today: fewer while it is not verified. */
function maxNumbersFor(row: { emailVerified: boolean; phoneNumberVerified: boolean } | undefined): number {
  return row && isAccountVerified(row) ? MAX_NUMBERS_PER_VERIFIED_ACCOUNT : MAX_NUMBERS_PER_UNVERIFIED_ACCOUNT
}

const verifiedColumns = { emailVerified: user.emailVerified, phoneNumberVerified: user.phoneNumberVerified }

/** The other numbers this account already claimed today, as a filter on `rate_limit` rows. */
const otherAccountNumbers = (userId: string, phone: string, at: Date) =>
  and(sql`starts_with(${rateLimit.key}, ${accountPrefix(userId, at)})`, ne(rateLimit.key, `${accountPrefix(userId, at)}${phone}`))

/** Reads every limit and says which one (if any) stops this request. Counts nothing: see `hitCodeLimits`. */
export async function checkCodeLimits(db: Db, input: CodeLimitInput): Promise<CodeLimitResult> {
  const at = input.at ?? now()
  const { phone } = input
  const purpose = input.purpose ?? 'verify'

  const [last] = await db
    .select({ windowStart: rateLimit.windowStart })
    .from(rateLimit)
    .where(and(eq(rateLimit.key, numKey(phone, purpose)), gte(rateLimit.windowStart, new Date(at.getTime() - COOLDOWN_MS + 1))))
  if (last) {
    return { ok: false, reason: 'cooldown', retryAfter: Math.max(1, Math.ceil((last.windowStart.getTime() + COOLDOWN_MS - at.getTime()) / 1000)) }
  }

  const day = await isRateLimited(db, dayKey(phone, purpose), NUMBER_DAY_RULE, at)
  if (day.limited) return { ok: false, reason: 'number_day', retryAfter: day.retryAfter }

  if (input.userId && purpose !== 'reset') {
    const [account] = await db.select(verifiedColumns).from(user).where(eq(user.id, input.userId))
    const [row] = await db.select({ n: count() }).from(rateLimit).where(otherAccountNumbers(input.userId, phone, at))
    if ((row?.n ?? 0) >= maxNumbersFor(account)) return { ok: false, reason: 'account_numbers', retryAfter: untilMidnight(at) }
  }

  const ip = await isRateLimited(db, ipKey(input.ip), IP_RULE, at)
  if (ip.limited) return { ok: false, reason: 'ip', retryAfter: ip.retryAfter }

  if ((await codesClaimedToday(db, at, purpose)) >= MAX_CODES_PER_DAY[purpose]) return { ok: false, reason: 'global', retryAfter: untilMidnight(at) }

  return { ok: true }
}

/**
 * Claims one code against every limit in a single transaction, and throws `CodeLimitedError` (claiming nothing)
 * when any of them is used up. Each claim is atomic, so parallel requests cannot all pass: the number's 60-second
 * slot and the platform's day budget are conditional upserts, the number-day and IP counters are atomic increments
 * whose result is checked, and an account's distinct numbers are claimed one row per number while holding the account's
 * row lock. Call it right after `checkCodeLimits` returned ok (the check gives the friendly early answer).
 */
export async function hitCodeLimits(db: Db, input: CodeLimitInput): Promise<void> {
  const at = input.at ?? now()
  const { phone } = input
  const purpose = input.purpose ?? 'verify'
  await db.transaction(async (tx) => {
    const t = tx as unknown as Db
    const slot = await t
      .insert(rateLimit)
      .values({ key: numKey(phone, purpose), windowStart: at, count: 1 })
      .onConflictDoUpdate({
        target: rateLimit.key,
        set: { windowStart: at, count: 1 },
        setWhere: sql`${rateLimit.windowStart} <= ${new Date(at.getTime() - COOLDOWN_MS)}`,
      })
      .returning({ key: rateLimit.key })
    if (slot.length === 0) throw new CodeLimitedError('cooldown', COOLDOWN_MS / 1000)

    const day = await hitRateLimit(t, dayKey(phone, purpose), NUMBER_DAY_RULE, at)
    if (day.limited) throw new CodeLimitedError('number_day', day.retryAfter)

    if (input.userId && purpose !== 'reset') {
      // Two parallel requests of one account queue here, so the count below cannot be read stale.
      const [account] = await t.select(verifiedColumns).from(user).where(eq(user.id, input.userId)).for('update')
      const own = `${accountPrefix(input.userId, at)}${phone}`
      const [known] = await t.select({ key: rateLimit.key }).from(rateLimit).where(eq(rateLimit.key, own))
      if (!known) {
        const [others] = await t.select({ n: count() }).from(rateLimit).where(otherAccountNumbers(input.userId, phone, at))
        if ((others?.n ?? 0) >= maxNumbersFor(account)) throw new CodeLimitedError('account_numbers', untilMidnight(at))
        await t.insert(rateLimit).values({ key: own, windowStart: at, count: 1 }).onConflictDoNothing()
      }
    }

    const ip = await hitRateLimit(t, ipKey(input.ip), IP_RULE, at)
    if (ip.limited) throw new CodeLimitedError('ip', ip.retryAfter)

    const budget = await t
      .insert(rateLimit)
      .values({ key: globalKey(at, purpose), windowStart: at, count: 1 })
      .onConflictDoUpdate({
        target: rateLimit.key,
        set: { count: sql`${rateLimit.count} + 1` },
        setWhere: sql`${rateLimit.count} < ${MAX_CODES_PER_DAY[purpose]}`,
      })
      .returning({ key: rateLimit.key })
    if (budget.length === 0) throw new CodeLimitedError('global', untilMidnight(at))
  })
}

/**
 * Counts one request against the IP's hourly limit and nothing else. For a password-reset request that cannot
 * lead to a message (no account holds the number, or the number is outside WHATSAPP_ALLOWLIST): it must still be
 * rate-limited per IP, but must not spend the number's or the platform's code budget. Never throws, never answers.
 */
export async function hitIpLimit(db: Db, ip: string | null, at: Date = now()): Promise<void> {
  await hitRateLimit(db, ipKey(ip), IP_RULE, at)
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
