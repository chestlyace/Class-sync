import { timingSafeEqual } from 'node:crypto'
import { runDueReminders } from '@/server/assignments/reminders'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

function authorized(header: string | null, secret: string): boolean {
  const expected = Buffer.from(`Bearer ${secret}`)
  const given = Buffer.from(header ?? '')
  // timingSafeEqual throws on different lengths; a length mismatch is already a rejection.
  return given.length === expected.length && timingSafeEqual(given, expected)
}

async function handle(request: Request): Promise<Response> {
  const secret = process.env.CRON_SECRET
  if (!secret) return Response.json({ error: 'CRON_SECRET is not configured' }, { status: 503 })
  if (!authorized(request.headers.get('authorization'), secret)) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 })
  }
  try {
    return Response.json(await runDueReminders())
  } catch (error) {
    console.error('[cron/reminders] run failed', error)
    return Response.json({ error: 'Reminder run failed' }, { status: 500 })
  }
}

// Vercel Cron calls GET and sends `Authorization: Bearer ${CRON_SECRET}` itself; POST is for manual runs.
export const GET = handle
export const POST = handle
