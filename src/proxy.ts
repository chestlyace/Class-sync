import { NextResponse, type NextRequest } from 'next/server'
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
  return NextResponse.next({ request: { headers } })
}

export const config = {
  // Pages only: not API routes, Next's own assets, or files with an extension.
  matcher: ['/((?!api/|_next/|.*\\.[^/]+$).*)'],
}
