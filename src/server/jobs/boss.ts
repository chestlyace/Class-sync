import { createHash } from 'node:crypto'
import type { PgBoss, Queue } from 'pg-boss'
import { MARKING_TOPIC } from '@/server/assignments/ai/queue'
import { poolSsl } from '@/server/db/ssl'
import { CLASS_NOTICES_TOPIC } from '@/server/schedule/queue'

/** pg-boss keeps its tables in this schema of the app's database, apart from the app's own. */
export const BOSS_SCHEMA = 'pgboss'

/** The daily runs (Vercel Cron's two paths in vercel.json). */
export const DAILY_REMINDERS_QUEUE = 'daily-reminders'
export const DAILY_SCHEDULE_QUEUE = 'daily-schedule'

/**
 * Every queue and how its jobs are retried. A job whose handler throws (a database error) is retried;
 * one still active after `expireInSeconds` (the dyno restarted mid-job) is retried too.
 */
export const QUEUES: Record<string, Omit<Queue, 'name'>> = {
  // Due at a sitting's start or end. Not delivered more than an hour late, like the Vercel queue's retention.
  [CLASS_NOTICES_TOPIC]: { retryLimit: 5, retryDelay: 60, retryBackoff: true, expireInSeconds: 120, retentionSeconds: 3600 },
  // Two deliveries at most (the job stops calling the model on a redelivery of a cut-off run), 50 s budget.
  [MARKING_TOPIC]: { retryLimit: 1, retryDelay: 30, expireInSeconds: 120, retentionSeconds: 86_400 },
  [DAILY_REMINDERS_QUEUE]: { retryLimit: 2, retryDelay: 300, expireInSeconds: 600, retentionSeconds: 6 * 3600 },
  [DAILY_SCHEDULE_QUEUE]: { retryLimit: 2, retryDelay: 300, expireInSeconds: 600, retentionSeconds: 6 * 3600 },
}

/** Creates the queues that are missing and brings the others' settings up to date. */
async function ensureQueues(boss: PgBoss): Promise<void> {
  for (const [name, options] of Object.entries(QUEUES)) {
    if (await boss.getQueue(name)) await boss.updateQueue(name, options)
    else await boss.createQueue(name, options)
  }
}

const globalForBoss = globalThis as typeof globalThis & { __clasyncBoss?: Promise<PgBoss> }

async function create(): Promise<PgBoss> {
  const connectionString = process.env.DATABASE_URL
  if (!connectionString) throw new Error('DATABASE_URL is not set')
  const { PgBoss } = await import('pg-boss')
  // A small pool of its own: the app's pool holds 5 and Heroku's Essential-0 plan allows 20 in all.
  const boss = new PgBoss({
    connectionString,
    ssl: poolSsl(connectionString),
    schema: BOSS_SCHEMA,
    max: 3,
    application_name: 'clasync-jobs',
  })
  // Without a listener an 'error' event would crash the process; logged errors also reach Sentry.
  boss.on('error', (error) => console.error('[jobs] pg-boss error', error))
  await boss.start()
  await ensureQueues(boss)
  return boss
}

/**
 * The started pg-boss instance of this process (created on first use, then shared). A failed start is
 * not kept, so the next call tries again.
 */
export function getBoss(): Promise<PgBoss> {
  const existing = globalForBoss.__clasyncBoss
  if (existing) return existing
  const started = create()
  globalForBoss.__clasyncBoss = started
  started.catch(() => {
    if (globalForBoss.__clasyncBoss === started) globalForBoss.__clasyncBoss = undefined
  })
  return started
}

/**
 * A job id fixed by `key` (a UUID built from its SHA-256), so sending the same job twice stores it once:
 * pg-boss skips an id it already holds, as Vercel Queues did with an idempotency key.
 */
export function jobIdFor(queue: string, key: string): string {
  const hex = createHash('sha256').update(`${queue}\n${key}`).digest('hex')
  const variant = ((parseInt(hex[16], 16) & 0x3) | 0x8).toString(16)
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-5${hex.slice(13, 16)}-${variant}${hex.slice(17, 20)}-${hex.slice(20, 32)}`
}
