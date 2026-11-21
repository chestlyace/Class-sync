import { queueDriver } from '@/server/jobs/driver'

/**
 * Heroku: background jobs run in this server process (src/server/jobs/worker.ts). Started without
 * holding up the server; a failure is logged (and so reported) and the site keeps serving.
 */
export async function startBackgroundJobs(): Promise<void> {
  if (queueDriver() !== 'pgboss') return
  try {
    const { startJobWorkers } = await import('@/server/jobs/worker')
    await startJobWorkers()
    console.log('[jobs] background job workers started')
  } catch (error) {
    console.error('[jobs] background job workers failed to start', error)
  }
}
