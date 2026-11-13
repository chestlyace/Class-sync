import { runDueReminders } from '@/server/assignments/reminders'
import { isCronAuthorized } from '@/server/lib/cron-auth'
import { pruneRateLimits } from '@/server/lib/rate-limit'
import { pruneUnusedOauthClients } from '@/server/mcp/prune'
import { pruneOpsEvents, recordOpsEventDefault } from '@/server/ops/events'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

async function handle(request: Request): Promise<Response> {
  const secret = process.env.CRON_SECRET
  if (!secret) return Response.json({ error: 'CRON_SECRET is not configured' }, { status: 503 })
  if (!isCronAuthorized(request.headers.get('authorization'), secret)) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 })
  }
  // Daily housekeeping rides on this cron. Its failure is logged and never blocks the reminders.
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
    return Response.json({ ...result, oauthClientsPruned, rateLimitsPruned, opsEventsPruned })
  } catch (error) {
    console.error('[cron/reminders] run failed', error)
    await recordOpsEventDefault({ kind: 'cron_reminders', ok: false, detail: { error: 'run failed' } })
    return Response.json({ error: 'Reminder run failed' }, { status: 500 })
  }
}

// Vercel Cron calls GET and sends `Authorization: Bearer ${CRON_SECRET}` itself; POST is for manual runs.
export const GET = handle
export const POST = handle
