import { NextResponse, type NextRequest } from 'next/server'
import { CLIENT_IP_HEADER, forwardedClientIp } from '@/lib/client-ip'
import { REQUEST_PATH_HEADER } from '@/lib/next-path'

/**
 * Tells the server components which page was asked for: layouts cannot see the URL, and the
 * signed-in layout needs it to send a signed-out visitor to `/sign-in?next=<this page>` (a shared
 * join or check-in link must survive signing in). Always overwritten, never trusted as more than
 * a `next` candidate (safeNextPath still checks it).
 */
export function proxy(request: NextRequest) {
  const headers = new Headers(request.headers)
  headers.set(REQUEST_PATH_HEADER, `${request.nextUrl.pathname}${request.nextUrl.search}`)
  // The client's IP for Better Auth's rate limits and sessions, worked out once for the platform (Heroku's
  // router appends to a client's own x-forwarded-for). A value the client sent is never passed on.
  headers.delete(CLIENT_IP_HEADER)
  const ip = forwardedClientIp(request.headers)
  if (ip) headers.set(CLIENT_IP_HEADER, ip)
  return NextResponse.next({ request: { headers } })
}

export const config = {
  // Pages, plus Better Auth's routes (the client IP above); not other API routes, Next's own assets, or
  // files with an extension.
  matcher: ['/((?!api/|_next/|.*\\.[^/]+$).*)', '/api/auth/:path*'],
}
