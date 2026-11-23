import { runScheduleDaily } from '@/server/jobs/daily'
import { isCronAuthorized } from '@/server/lib/cron-auth'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

async function handle(request: Request): Promise<Response> {
  const secret = process.env.CRON_SECRET
  if (!secret) return Response.json({ error: 'CRON_SECRET is not configured' }, { status: 503 })
  if (!isCronAuthorized(request.headers.get('authorization'), secret)) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const run = await runScheduleDaily()
  if (!run.ok) return Response.json({ error: 'Schedule run failed' }, { status: 500 })
  return Response.json({ sittings: run.sittings })
}

// Vercel Cron calls GET and sends `Authorization: Bearer ${CRON_SECRET}` itself; POST is for manual runs.
// On Heroku the same run is a pg-boss schedule (src/server/jobs/worker.ts).
export const GET = handle
export const POST = handle
