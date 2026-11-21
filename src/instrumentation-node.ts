import { queueDriver } from '@/server/jobs/driver'

/**
 * Heroku: background jobs run in this server process (src/server/jobs/worker.ts). Started without
 * holding up the server. A failed start (the database unreachable at boot) is logged, and so reported,
 * and tried again after 5 s, then 10, 20, 40 and every 60 s, until it works; the site keeps serving.
 */
export async function startBackgroundJobs(): Promise<void> {
  if (queueDriver() !== 'pgboss') return
  const { startJobWorkers } = await import('@/server/jobs/worker')
  for (let delayMs = 5_000; ; delayMs = Math.min(delayMs * 2, 60_000)) {
    try {
      await startJobWorkers()
      console.log('[jobs] background job workers started')
      return
    } catch (error) {
      console.error('[jobs] background job workers failed to start; trying again', error)
      await new Promise((resolve) => setTimeout(resolve, delayMs).unref?.())
    }
  }
}
