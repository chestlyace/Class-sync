type Env = Record<string, string | undefined>

/**
 * How background jobs (class notices, AI marking, the daily runs) are carried:
 * - `vercel`: Vercel Queues and Vercel Cron (the Vercel deployments, until the move to Heroku is done);
 * - `pgboss`: pg-boss, a job table in the app's own Postgres, worked inside the web process (Heroku);
 * - `memory`: a timer in this process (a laptop, the tests).
 * `QUEUE_DRIVER` chooses; otherwise Vercel when VERCEL is set, pg-boss on Heroku (DYNO is set), memory elsewhere.
 */
export type QueueDriver = 'vercel' | 'pgboss' | 'memory'

export function queueDriver(env: Env = process.env): QueueDriver {
  const explicit = env.QUEUE_DRIVER?.trim()
  if (explicit === 'vercel' || explicit === 'pgboss' || explicit === 'memory') return explicit
  if (env.VERCEL) return 'vercel'
  if (env.DYNO) return 'pgboss'
  return 'memory'
}
