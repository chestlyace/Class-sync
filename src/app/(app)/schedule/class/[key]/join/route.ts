import { getCtx } from '@/server/auth/session'
import { AppError } from '@/server/core/errors'
import { joinOnlineClass } from '@/server/schedule/join'

export const dynamic = 'force-dynamic'

/** The short-lived link a reminder or the dashboard sends students to. Never returns the URL in a page or API body. */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ key: string }> },
): Promise<Response> {
  const { key } = await params
  const headers = { 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' }
  let ctx: Awaited<ReturnType<typeof getCtx>>
  try {
    ctx = await getCtx()
  } catch (err) {
    if (err instanceof AppError && err.code === 'UNAUTHENTICATED') {
      const next = `/schedule/class/${encodeURIComponent(key)}/join`
      return new Response(null, { status: 303, headers: { ...headers, Location: `/sign-in?next=${encodeURIComponent(next)}` } })
    }
    throw err
  }

  try {
    const result = await joinOnlineClass(ctx, key)
    if (result.kind === 'notice') {
      return new Response(null, {
        status: 303,
        headers: { ...headers, Location: `/dashboard?join=${result.reason === 'notOpen' ? 'not-open' : 'ended'}` },
      })
    }
    return new Response(null, { status: 303, headers: { ...headers, Location: result.url } })
  } catch (err) {
    if (err instanceof AppError && err.code === 'NOT_FOUND') {
      return new Response(null, { status: 404, headers })
    }
    throw err
  }
}
