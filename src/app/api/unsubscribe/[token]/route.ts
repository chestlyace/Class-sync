import { unsubscribeLinkToken } from '@/server/broadcasts/unsubscribe'

/**
 * One-click unsubscribe (RFC 8058): mail providers POST here from their servers when someone
 * presses "Unsubscribe" in their inbox. No session, no origin check, and always 200 whatever the
 * token, so nothing can be learned from the answer.
 */
export async function POST(_request: Request, { params }: RouteContext<'/api/unsubscribe/[token]'>) {
  const { token } = await params
  await unsubscribeLinkToken(token)
  return new Response(null, { status: 200 })
}

/**
 * A person who opens the header address in a browser gets the page with the button. A GET never
 * unsubscribes: mail scanners open links.
 */
export async function GET(_request: Request, { params }: RouteContext<'/api/unsubscribe/[token]'>) {
  const { token } = await params
  return new Response(null, { status: 303, headers: { Location: `/unsubscribe/${encodeURIComponent(token)}` } })
}
