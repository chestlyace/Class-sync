const CORS: Record<string, string> = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'GET, OPTIONS',
  'access-control-allow-headers': 'content-type, mcp-protocol-version',
  'access-control-max-age': '86400',
}

/**
 * OAuth discovery documents live at the site root (RFC 8414 / RFC 9728) but Better Auth serves
 * them from its handler: forward GETs to it and add CORS so browser-based clients can read them.
 */
export async function forwardWellKnown(req: Request, handler: (req: Request) => Promise<Response>): Promise<Response> {
  const res = await handler(req)
  const headers = new Headers(res.headers)
  for (const [k, v] of Object.entries(CORS)) headers.set(k, v)
  return new Response(res.body, { status: res.status, statusText: res.statusText, headers })
}

export function wellKnownPreflight(): Response {
  return new Response(null, { status: 204, headers: CORS })
}
