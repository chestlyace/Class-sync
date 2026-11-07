import { timingSafeEqual } from 'node:crypto'
import { runDueReminders } from '@/server/assignments/reminders'

export const dynamic = 'force-dynamic'

function authorized(header: string | null, secret: string): boolean {
  const expected = Buffer.from(`Bearer ${secret}`)
  const given = Buffer.from(header ?? '')
  // timingSafeEqual throws on different lengths; a length mismatch is already a rejection.
  return given.length === expected.length && timingSafeEqual(given, expected)
}

export async function POST(request: Request): Promise<Response> {
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

export function GET(): Response {
  return Response.json({ error: 'Method not allowed' }, { status: 405, headers: { Allow: 'POST' } })
}
