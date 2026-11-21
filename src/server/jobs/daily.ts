import { runDueReminders } from '@/server/assignments/reminders'
import { now } from '@/server/core/clock'
import { pruneRateLimits } from '@/server/lib/rate-limit'
import { pruneUnusedOauthClients } from '@/server/mcp/prune'
import { pruneOpsEvents, recordOpsEventDefault } from '@/server/ops/events'
import { enqueueTodayDefault } from '@/server/schedule/default-db'

// The two daily runs, called by the cron routes (Vercel Cron) and by the pg-boss schedules (Heroku).

export type RemindersRun =
  | {
      ok: true
      assignments: number
      reminded: number
      oauthClientsPruned: number | null
      rateLimitsPruned: number | null
      opsEventsPruned: number | null
    }
  | { ok: false }

/** 06:00 UTC: assignment reminders, plus housekeeping whose failure is logged and never blocks them. */
export async function runRemindersDaily(): Promise<RemindersRun> {
  const oauthClientsPruned = await pruneUnusedOauthClients().catch((error: unknown) => {
    console.error('[cron/reminders] pruning unused OAuth clients failed', error)
    return null
  })
  const rateLimitsPruned = await pruneRateLimits().catch((error: unknown) => {
    console.error('[cron/reminders] pruning rate limit counters failed', error)
    return null
  })
  const opsEventsPruned = await pruneOpsEvents().catch((error: unknown) => {
    console.error('[cron/reminders] pruning ops events failed', error)
    return null
  })
  try {
    const result = await runDueReminders()
    await recordOpsEventDefault({
      kind: 'cron_reminders',
      ok: true,
      detail: { assignments: result.assignments, reminded: result.reminded },
    })
    return { ok: true, ...result, oauthClientsPruned, rateLimitsPruned, opsEventsPruned }
  } catch (error) {
    console.error('[cron/reminders] run failed', error)
    await recordOpsEventDefault({ kind: 'cron_reminders', ok: false, detail: { error: 'run failed' } })
    return { ok: false }
  }
}

/** 03:00 UTC: queues today's class reminders and missed-check notices. */
export async function runScheduleDaily(): Promise<{ ok: true; sittings: number } | { ok: false }> {
  try {
    const { sittings } = await enqueueTodayDefault(now())
    await recordOpsEventDefault({ kind: 'cron_schedule', ok: true, detail: { sittings } })
    return { ok: true, sittings }
  } catch (error) {
    console.error('[cron/schedule] run failed', error)
    await recordOpsEventDefault({ kind: 'cron_schedule', ok: false, detail: { error: 'run failed' } })
    return { ok: false }
  }
}
