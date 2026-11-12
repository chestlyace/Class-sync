import { and, eq, inArray, isNull, sql } from 'drizzle-orm'
import type { Db } from '@/server/db'
import { pushSubscription, user } from '@/server/db/schema'
import { emailDb } from '@/server/email/db'
import { runAfterResponse } from '@/server/lib/after-response'
import { recordOpsEvent, scrubError } from '@/server/ops/events'
import type { PushKind, PushPayload } from './payload'

export type PushItem = { userId: string; payload: PushPayload }

/** The slice of web-push this module uses, so tests can substitute it. Rejects with { statusCode?, message }. */
export type PushClient = {
  send(
    sub: { endpoint: string; keys: { p256dh: string; auth: string } },
    body: string,
    opts: DeliveryOptions,
  ): Promise<void>
}

type DeliveryOptions = { TTL: number; urgency: 'normal' | 'high'; timeout: number }

const MAX_IN_FLIGHT = 20
const DAY_S = 86_400
/** Milliseconds one push-service request may take before it counts as a failure. */
const SEND_TIMEOUT_MS = 10_000
/** A device that failed this many sends in a row (without a success) is deleted. */
export const MAX_CONSECUTIVE_FAILURES = 5

let testClient: PushClient | null = null
let realClient: PushClient | null = null

/** Replaces the push client in tests (VAPID keys are then treated as present). Pass null to restore the real one. */
export function setPushClientForTests(client: PushClient | null): void {
  testClient = client
}

function vapidKeys(): { publicKey: string; privateKey: string } | null {
  const publicKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY
  const privateKey = process.env.VAPID_PRIVATE_KEY
  return publicKey && privateKey ? { publicKey, privateKey } : null
}

async function createRealClient(publicKey: string, privateKey: string): Promise<PushClient> {
  if (realClient) return realClient
  const { default: webpush } = await import('web-push')
  webpush.setVapidDetails(process.env.VAPID_SUBJECT || 'mailto:support@clasync.online', publicKey, privateKey)
  realClient = {
    async send(sub, body, opts) {
      await webpush.sendNotification(sub, body, opts)
    },
  }
  return realClient
}

function deliveryOptions(kind: PushKind): DeliveryOptions {
  const timeout = SEND_TIMEOUT_MS
  if (kind === 'checkInOpened' || kind === 'checkOutOpened') return { TTL: 900, urgency: 'high', timeout }
  if (kind === 'testStarted') return { TTL: 3600, urgency: 'high', timeout }
  return { TTL: DAY_S, urgency: 'normal', timeout }
}

type Job = { id: string; endpoint: string; keys: { p256dh: string; auth: string }; payload: PushPayload }
type Failure = { id: string; gone: boolean; error: string }
type Outcome = { id: string; ok: true } | ({ ok: false } & Failure)

async function runLimited<T, R>(list: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(list.length)
  let next = 0
  const workers = Array.from({ length: Math.min(limit, list.length) }, async () => {
    while (next < list.length) {
      const i = next++
      results[i] = await fn(list[i])
    }
  })
  await Promise.all(workers)
  return results
}

/**
 * Best-effort web push to every device of each listed user. It never throws: a missing VAPID key
 * or a push-service outage must not fail the action that triggered the notification. Without keys
 * (and no test client) nothing is sent, one warning with the count is logged and the database is
 * not touched. Suspended users' devices are skipped. A device the push service reports gone
 * (404/410) is deleted; other failures (a request times out after 10 s) count against it, and a
 * device that reaches MAX_CONSECUTIVE_FAILURES in a row is deleted too (counted in `removed`).
 * One `push_sent` and/or one `push_failed` health event records counts only, never endpoints;
 * malformed VAPID keys record one `push_failed` for every device that was not sent to.
 */
export async function sendPush(
  items: PushItem[],
  db?: Db,
): Promise<{ sent: number; skipped: number; failed: number; removed: number }> {
  const result = { sent: 0, skipped: 0, failed: 0, removed: 0 }
  if (items.length === 0) return result
  try {
    const keys = vapidKeys()
    if (!testClient && !keys) {
      console.warn(`[push] VAPID keys are not set: ${items.length} push notification(s) not sent`)
      result.skipped = items.length
      return result
    }
    const conn = db ?? emailDb()

    const userIds = [...new Set(items.map((i) => i.userId))]
    const rows = await conn
      .select({
        id: pushSubscription.id,
        userId: pushSubscription.userId,
        endpoint: pushSubscription.endpoint,
        p256dh: pushSubscription.p256dh,
        auth: pushSubscription.auth,
      })
      .from(pushSubscription)
      .innerJoin(user, eq(user.id, pushSubscription.userId))
      .where(and(inArray(pushSubscription.userId, userIds), isNull(user.suspendedAt)))
    const byUser = new Map<string, typeof rows>()
    for (const row of rows) byUser.set(row.userId, [...(byUser.get(row.userId) ?? []), row])

    const jobs: Job[] = []
    for (const item of items) {
      const devices = byUser.get(item.userId) ?? []
      if (devices.length === 0) result.skipped += 1
      for (const d of devices) {
        jobs.push({ id: d.id, endpoint: d.endpoint, keys: { p256dh: d.p256dh, auth: d.auth }, payload: item.payload })
      }
    }
    if (jobs.length === 0) return result

    let client: PushClient
    try {
      client = testClient ?? (await createRealClient(keys!.publicKey, keys!.privateKey))
    } catch (error) {
      // Malformed VAPID keys: a misconfiguration, so it shows on the admin health page.
      console.error('[push] could not set up the push client', error)
      result.failed = jobs.length
      await recordOpsEvent(conn, {
        kind: 'push_failed',
        ok: false,
        detail: { count: jobs.length, error: scrubError(String((error as Error | null)?.message ?? error)) },
      })
      return result
    }
    const outcomes = await runLimited(jobs, MAX_IN_FLIGHT, async (job): Promise<Outcome> => {
      try {
        await client.send(
          { endpoint: job.endpoint, keys: job.keys },
          JSON.stringify(job.payload),
          deliveryOptions(job.payload.kind),
        )
        return { id: job.id, ok: true }
      } catch (error) {
        const e = error as { statusCode?: number; message?: string } | null
        const status = e?.statusCode
        return { id: job.id, ok: false, gone: status === 404 || status === 410, error: String(e?.message ?? 'send failed') }
      }
    })

    const okIds: string[] = []
    const goneIds: string[] = []
    const failures: Failure[] = []
    for (const o of outcomes) {
      if (o.ok) okIds.push(o.id)
      else if (o.gone) goneIds.push(o.id)
      else failures.push(o)
    }
    result.sent = okIds.length
    result.removed = goneIds.length
    result.failed = failures.length

    try {
      if (okIds.length) {
        await conn
          .update(pushSubscription)
          .set({ failureCount: 0, lastSuccessAt: new Date() })
          .where(inArray(pushSubscription.id, okIds))
      }
      if (goneIds.length) await conn.delete(pushSubscription).where(inArray(pushSubscription.id, goneIds))
      if (failures.length) {
        const counted = await conn
          .update(pushSubscription)
          .set({ failureCount: sql`${pushSubscription.failureCount} + 1` })
          .where(
            inArray(
              pushSubscription.id,
              failures.map((f) => f.id),
            ),
          )
          .returning({ id: pushSubscription.id, failureCount: pushSubscription.failureCount })
        // Failing every time: stop trying this device.
        const worn = counted.filter((r) => r.failureCount >= MAX_CONSECUTIVE_FAILURES).map((r) => r.id)
        if (worn.length) {
          const deleted = await conn
            .delete(pushSubscription)
            .where(inArray(pushSubscription.id, worn))
            .returning({ id: pushSubscription.id })
          result.removed += deleted.length
          result.failed -= deleted.length
        }
      }
    } catch (error) {
      console.error('[push] could not update subscriptions after sending', error)
    }

    if (result.sent > 0) await recordOpsEvent(conn, { kind: 'push_sent', ok: true, detail: { count: result.sent } })
    const failedTotal = result.failed + result.removed
    if (failedTotal > 0) {
      await recordOpsEvent(conn, {
        kind: 'push_failed',
        ok: false,
        detail: {
          count: failedTotal,
          removed: result.removed,
          ...(failures[0] ? { error: scrubError(failures[0].error) } : {}),
        },
      })
    }
  } catch (error) {
    console.error('[push] sending failed', error)
  }
  return result
}

/**
 * Prepares push notifications now and sends them after the response. Never throws: a failure
 * while gathering what they need is logged and nothing is sent.
 */
export async function queuePush(context: string, build: () => Promise<PushItem[]>): Promise<void> {
  let items: PushItem[]
  try {
    items = await build()
  } catch (error) {
    console.error(`[${context}] could not prepare push notifications`, error)
    return
  }
  if (items.length === 0) return
  runAfterResponse(async () => {
    await sendPush(items)
  })
}
