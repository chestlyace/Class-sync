import { runMarkingJobDefault } from '@/server/assignments/ai/default-db'
import { MARKING_TOPIC, type MarkingMessage } from '@/server/assignments/ai/queue'
import { now } from '@/server/core/clock'
import { handleNoticeDefault } from '@/server/schedule/default-db'
import { CLASS_NOTICES_TOPIC, type NoticeMessage } from '@/server/schedule/queue'
import { handleWhatsAppEventDefault } from '@/server/whatsapp/default-db'
import { WHATSAPP_TOPIC, type WhatsAppEvent } from '@/server/whatsapp/events'
import { DAILY_REMINDERS_QUEUE, DAILY_SCHEDULE_QUEUE, getBoss, resetBoss } from './boss'
import { runRemindersDaily, runScheduleDaily } from './daily'

/**
 * Heroku: the web process also works the background jobs (one Basic dyno, no worker dyno). Called once at
 * server start (src/instrumentation.ts) when the queue driver is pg-boss. The two daily runs are pg-boss
 * schedules at Vercel Cron's times (UTC); a run missed while the dyno was down happens once it is back.
 * A handler that throws makes pg-boss retry the job (QUEUES in ./boss).
 */
export async function startJobWorkers(): Promise<void> {
  try {
    await registerWorkers()
  } catch (error) {
    // Half-registered workers would run twice after a retry: start again from a fresh instance.
    await resetBoss()
    throw error
  }
}

async function registerWorkers(): Promise<void> {
  const boss = await getBoss()

  await boss.work<NoticeMessage>(CLASS_NOTICES_TOPIC, { localConcurrency: 2 }, async ([job]) => {
    await handleNoticeDefault(job.data)
  })

  // retryCount is 0 on the first delivery: the job counts deliveries from 1, as Vercel Queues did.
  await boss.work<MarkingMessage>(MARKING_TOPIC, { localConcurrency: 2 }, async ([job]) => {
    await runMarkingJobDefault(job.data, job.retryCount + 1)
  })

  // Who still needs a message is worked out at delivery time; a throw (a database error) retries the event.
  await boss.work<WhatsAppEvent>(WHATSAPP_TOPIC, { localConcurrency: 2 }, async ([job]) => {
    await handleWhatsAppEventDefault(job.data, now())
  })

  await boss.work(DAILY_REMINDERS_QUEUE, async () => {
    if (!(await runRemindersDaily()).ok) throw new Error('Daily reminders run failed')
  })
  await boss.work(DAILY_SCHEDULE_QUEUE, async () => {
    if (!(await runScheduleDaily()).ok) throw new Error('Daily schedule run failed')
  })

  await boss.schedule(DAILY_SCHEDULE_QUEUE, '0 3 * * *', null, { tz: 'UTC', missed: 'once' })
  await boss.schedule(DAILY_REMINDERS_QUEUE, '0 6 * * *', null, { tz: 'UTC', missed: 'once' })

  // Heroku sends SIGTERM on every restart and deploy, then waits 30 s: let running jobs finish (or hand
  // them back) instead of leaving them to expire.
  process.once('SIGTERM', () => {
    void boss.stop({ graceful: true, timeout: 20_000 }).catch(() => {})
  })
}
