import { now } from '@/server/core/clock'
import { isCronAuthorized } from '@/server/lib/cron-auth'
import { recordOpsEventDefault } from '@/server/ops/events'
import { enqueueTodayDefault } from '@/server/schedule/default-db'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

async function handle(request: Request): Promise<Response> {
  const secret = process.env.CRON_SECRET
  if (!secret) return Response.json({ error: 'CRON_SECRET is not configured' }, { status: 503 })
  if (!isCronAuthorized(request.headers.get('authorization'), secret)) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 })
  }
  try {
    const { sittings } = await enqueueTodayDefault(now())
    await recordOpsEventDefault({ kind: 'cron_schedule', ok: true, detail: { sittings } })
    return Response.json({ sittings })
  } catch (error) {
    console.error('[cron/schedule] run failed', error)
    await recordOpsEventDefault({ kind: 'cron_schedule', ok: false, detail: { error: 'run failed' } })
    return Response.json({ error: 'Schedule run failed' }, { status: 500 })
  }
}

// Vercel Cron calls GET and sends `Authorization: Bearer ${CRON_SECRET}` itself; POST is for manual runs.
export const GET = handle
export const POST = handle
