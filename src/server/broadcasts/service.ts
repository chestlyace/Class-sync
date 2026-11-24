import { and, count, desc, eq, inArray, isNull, sql } from 'drizzle-orm'
import { z } from 'zod'
import type { Ctx } from '@/server/core/context'
import { AppError } from '@/server/core/errors'
import { requireAdmin } from '@/server/core/guards'
import { adminAction, BROADCAST_AUDIENCES, broadcast, broadcastRecipient, user } from '@/server/db/schema'
import type { BroadcastAudience, BroadcastStatus } from '@/server/db/schema'
import { enqueueBroadcast } from './queue'
import { broadcastSender, renderBroadcast } from './sender'
import { unsubscribePageUrl, unsubscribeTokenFor, unsubscribeUrl } from './unsubscribe'

export { BROADCAST_AUDIENCES }
export type { BroadcastAudience }

/** Limits for each of the four fields, shared with the form on the admin page. */
export const BROADCAST_SUBJECT_MAX = 150
export const BROADCAST_BODY_MAX = 10_000

/** The words that confirm a send, in either language. */
const CONFIRMATION_WORDS = ['SEND', 'ENVOYER']

/** Recipient rows are inserted in chunks to stay under the database's parameter limit. */
const INSERT_CHUNK = 1000

/** The most failed or skipped rows the detail view lists; the counts above it are always complete. */
const PROBLEMS_LIMIT = 500

const LIST_LIMIT = 50

const subjectField = z.string().trim().min(1).max(BROADCAST_SUBJECT_MAX)
const bodyField = z.string().trim().min(1).max(BROADCAST_BODY_MAX)

export const broadcastInputSchema = z.object({
  id: z.string().uuid(),
  audience: z.enum(BROADCAST_AUDIENCES),
  subjectEn: subjectField,
  bodyEn: bodyField,
  subjectFr: subjectField,
  bodyFr: bodyField,
})
export type BroadcastInput = z.infer<typeof broadcastInputSchema>

const testInputSchema = broadcastInputSchema.omit({ id: true, audience: true })
export type BroadcastTestInput = z.infer<typeof testInputSchema>

function parseInput<T extends z.ZodType>(schema: T, input: unknown): z.infer<T> {
  const result = schema.safeParse(input)
  if (!result.success) {
    const fields = [...new Set(result.error.issues.map((i) => i.path.join('.')))]
    throw new AppError('VALIDATION', 'Invalid input', { fields })
  }
  return result.data
}

/** Whether announcements can go out from this deployment (Amazon SES is set up, or we are in development). */
export function isBroadcastReady(): boolean {
  return broadcastSender() !== null
}

function rolesFor(audience: BroadcastAudience): Array<'lecturer' | 'student'> {
  if (audience === 'lecturers') return ['lecturer']
  if (audience === 'students') return ['student']
  return ['lecturer', 'student']
}

/** Verified, active accounts that have not turned announcements off. */
const receivesAnnouncements = and(
  eq(user.emailVerified, true),
  isNull(user.suspendedAt),
  isNull(user.announcementsOptOutAt),
)

/** How many people each audience would reach right now. */
export async function audienceCounts(ctx: Ctx): Promise<Record<BroadcastAudience, number>> {
  requireAdmin(ctx)
  const rows = await ctx.db
    .select({ role: user.role, n: count() })
    .from(user)
    .where(receivesAnnouncements)
    .groupBy(user.role)
  const lecturers = rows.find((r) => r.role === 'lecturer')?.n ?? 0
  const students = rows.find((r) => r.role === 'student')?.n ?? 0
  return { lecturers, students, everyone: lecturers + students }
}

async function recipientCount(ctx: Ctx, id: string): Promise<number> {
  const [row] = await ctx.db.select({ n: count() }).from(broadcastRecipient).where(eq(broadcastRecipient.broadcastId, id))
  return row?.n ?? 0
}

/**
 * A broadcast that was saved earlier: returns it as it stands. If it is still sending and has rows
 * nobody has picked up (the first request saved it but failed to queue the job), queues the job
 * again. That is harmless when a job is already running, because a run only claims pending rows.
 */
async function savedBroadcast(ctx: Ctx, id: string): Promise<{ id: string; recipients: number }> {
  const [row] = await ctx.db.select({ status: broadcast.status }).from(broadcast).where(eq(broadcast.id, id))
  const [pending] = await ctx.db
    .select({ n: count() })
    .from(broadcastRecipient)
    .where(and(eq(broadcastRecipient.broadcastId, id), eq(broadcastRecipient.status, 'pending')))
  if (row?.status === 'sending' && (pending?.n ?? 0) > 0) await startSending(id)
  return { id, recipients: await recipientCount(ctx, id) }
}

/**
/**
 * Queues the sending job of a broadcast that is already saved. When the queue fails, the broadcast
 * stays saved with its rows pending: the admin is told to press Send again (the same id re-queues
 * it), and the daily run picks up any broadcast left like this for more than 10 minutes.
 */
async function startSending(id: string): Promise<void> {
  try {
    await enqueueBroadcast(id)
  } catch (error) {
    console.error('[broadcasts] saved broadcast could not be queued', { broadcastId: id }, error)
    throw new AppError('CONFLICT', 'The broadcast was saved but sending did not start. Send it again to start it.', {
      reason: 'not_started',
    })
  }
}

 * Saves a broadcast with its recipients and the audit row in one transaction, then queues the
 * sending job. Sending the same id again returns the saved broadcast and never sends twice (a
 * double click or a retried request is safe); it only queues the job again if the first request
 * failed to queue it and rows are still pending (a failed queueing throws CONFLICT with
 * `details.reason = 'not_started'`, and the broadcast stays saved). The recipient list is a snapshot: people
 * who sign up or opt out later are not added or removed here (the job still skips opted-out,
 * suspended and deleted accounts when it reaches them).
 */
export async function createBroadcast(
  ctx: Ctx,
  input: BroadcastInput,
  confirmation: string,
): Promise<{ id: string; recipients: number }> {
  requireAdmin(ctx)
  const data = parseInput(broadcastInputSchema, input)
  if (!CONFIRMATION_WORDS.includes(confirmation.trim().toUpperCase())) {
    throw new AppError('VALIDATION', 'Type SEND to confirm', { fields: ['confirmation'] })
  }

  const [existing] = await ctx.db.select({ id: broadcast.id }).from(broadcast).where(eq(broadcast.id, data.id))
  if (existing) return savedBroadcast(ctx, existing.id)

  if (!broadcastSender()) throw new AppError('CONFLICT', 'Email sending is not set up (SES_REGION)')

  const created = await ctx.db.transaction(async (tx) => {
    const people = await tx
      .select({ id: user.id, email: user.email, locale: user.locale })
      .from(user)
      .where(and(inArray(user.role, rolesFor(data.audience)), receivesAnnouncements))
    if (people.length === 0) throw new AppError('VALIDATION', 'Nobody to send to', { fields: ['audience'] })

    const inserted = await tx
      .insert(broadcast)
      .values({
        id: data.id,
        adminId: ctx.user.id,
        audience: data.audience,
        subjectEn: data.subjectEn,
        bodyEn: data.bodyEn,
        subjectFr: data.subjectFr,
        bodyFr: data.bodyFr,
      })
      .onConflictDoNothing()
      .returning({ id: broadcast.id })
    // A second request with the same id got here at the same moment and won: leave its rows alone.
    if (inserted.length === 0) return null

    for (let i = 0; i < people.length; i += INSERT_CHUNK) {
      await tx.insert(broadcastRecipient).values(
        people.slice(i, i + INSERT_CHUNK).map((p) => ({
          broadcastId: data.id,
          userId: p.id,
          email: p.email,
          locale: p.locale === 'fr' ? ('fr' as const) : ('en' as const),
        })),
      )
    }
    await tx.insert(adminAction).values({
      adminId: ctx.user.id,
      action: 'broadcast_send',
      details: {
        kind: 'broadcast_send',
        broadcastId: data.id,
        audience: data.audience,
        recipients: people.length,
        subjectEn: data.subjectEn,
      },
    })
    return people.length
  })

  if (created === null) return savedBroadcast(ctx, data.id)
  await startSending(data.id)
  return { id: data.id, recipients: created }
}

/**
 * Sends both language versions to the admin's own address so they can check them before the real
 * send. Writes nothing and ignores the admin's own opt-out.
 */
export async function sendTestBroadcast(ctx: Ctx, input: BroadcastTestInput): Promise<void> {
  requireAdmin(ctx)
  const data = parseInput(testInputSchema, input)
  const sender = broadcastSender()
  if (!sender) throw new AppError('CONFLICT', 'Email sending is not set up (SES_REGION)')

  const token = await unsubscribeTokenFor(ctx.db, ctx.user.id)
  const versions = [
    { locale: 'en' as const, subject: data.subjectEn, body: data.bodyEn },
    { locale: 'fr' as const, subject: data.subjectFr, body: data.bodyFr },
  ]
  for (const version of versions) {
    const email = await renderBroadcast({
      locale: version.locale,
      subject: `[Test] ${version.subject}`,
      body: version.body,
      to: ctx.user.email,
      unsubscribeUrl: unsubscribeUrl(token),
      unsubscribePageUrl: unsubscribePageUrl(token),
    })
    const result = await sender.send(email)
    if (!result.ok) throw new AppError('CONFLICT', result.error)
  }
}

export type BroadcastSummary = {
  id: string
  createdAt: Date
  adminName: string
  audience: BroadcastAudience
  subjectEn: string
  status: BroadcastStatus
  total: number
  sent: number
  failed: number
  skipped: number
}

export type BroadcastDetail = BroadcastSummary & {
  bodyEn: string
  subjectFr: string
  bodyFr: string
  problems: Array<{ email: string; status: 'failed' | 'skipped'; error: string | null }>
}

type Counts = Pick<BroadcastSummary, 'total' | 'sent' | 'failed' | 'skipped'>

async function countsFor(ctx: Ctx, ids: string[]): Promise<Map<string, Counts>> {
  const map = new Map<string, Counts>()
  if (ids.length === 0) return map
  const rows = await ctx.db
    .select({
      broadcastId: broadcastRecipient.broadcastId,
      total: count(),
      sent: sql<number>`count(*) filter (where ${broadcastRecipient.status} = 'sent')`.mapWith(Number),
      failed: sql<number>`count(*) filter (where ${broadcastRecipient.status} = 'failed')`.mapWith(Number),
      skipped: sql<number>`count(*) filter (where ${broadcastRecipient.status} = 'skipped')`.mapWith(Number),
    })
    .from(broadcastRecipient)
    .where(inArray(broadcastRecipient.broadcastId, ids))
    .groupBy(broadcastRecipient.broadcastId)
  for (const r of rows) map.set(r.broadcastId, { total: r.total, sent: r.sent, failed: r.failed, skipped: r.skipped })
  return map
}

const NO_COUNTS: Counts = { total: 0, sent: 0, failed: 0, skipped: 0 }

/** The latest broadcasts, newest first, with how many emails went out, failed or were skipped. */
export async function listBroadcasts(ctx: Ctx): Promise<BroadcastSummary[]> {
  requireAdmin(ctx)
  const rows = await ctx.db
    .select({
      id: broadcast.id,
      createdAt: broadcast.createdAt,
      adminName: user.name,
      audience: broadcast.audience,
      subjectEn: broadcast.subjectEn,
      status: broadcast.status,
    })
    .from(broadcast)
    .innerJoin(user, eq(user.id, broadcast.adminId))
    .orderBy(desc(broadcast.createdAt))
    .limit(LIST_LIMIT)
  const counts = await countsFor(
    ctx,
    rows.map((r) => r.id),
  )
  return rows.map((r) => ({ ...r, ...(counts.get(r.id) ?? NO_COUNTS) }))
}

/** One broadcast in full, with the addresses that failed or were skipped and why. */
export async function getBroadcast(ctx: Ctx, id: string): Promise<BroadcastDetail> {
  requireAdmin(ctx)
  const [row] = await ctx.db
    .select({
      id: broadcast.id,
      createdAt: broadcast.createdAt,
      adminName: user.name,
      audience: broadcast.audience,
      subjectEn: broadcast.subjectEn,
      bodyEn: broadcast.bodyEn,
      subjectFr: broadcast.subjectFr,
      bodyFr: broadcast.bodyFr,
      status: broadcast.status,
    })
    .from(broadcast)
    .innerJoin(user, eq(user.id, broadcast.adminId))
    .where(eq(broadcast.id, id))
  if (!row) throw new AppError('NOT_FOUND', 'No such broadcast')

  const [counts, problems] = await Promise.all([
    countsFor(ctx, [id]),
    ctx.db
      .select({ email: broadcastRecipient.email, status: broadcastRecipient.status, error: broadcastRecipient.error })
      .from(broadcastRecipient)
      .where(
        and(eq(broadcastRecipient.broadcastId, id), inArray(broadcastRecipient.status, ['failed', 'skipped'])),
      )
      .orderBy(broadcastRecipient.status, broadcastRecipient.email)
      .limit(PROBLEMS_LIMIT),
  ])
  return {
    ...row,
    ...(counts.get(id) ?? NO_COUNTS),
    problems: problems.map((p) => ({
      email: p.email,
      status: p.status === 'failed' ? ('failed' as const) : ('skipped' as const),
      error: p.error,
    })),
  }
}
