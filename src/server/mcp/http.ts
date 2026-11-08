import { resolveMcpCaller, type McpAuthDeps } from './auth'
import { createMcpServerHandler } from './server'

/** Permissive CORS without credentials: browser-based MCP clients send a bearer token, not cookies. */
export const MCP_CORS_HEADERS: Record<string, string> = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'POST, OPTIONS',
  'access-control-allow-headers': 'authorization, content-type, accept, mcp-protocol-version, mcp-session-id, last-event-id',
  'access-control-expose-headers': 'www-authenticate, mcp-protocol-version, mcp-session-id',
  'access-control-max-age': '86400',
}

function withCors(res: Response): Response {
  const headers = new Headers(res.headers)
  for (const [k, v] of Object.entries(MCP_CORS_HEADERS)) headers.set(k, v)
  return new Response(res.body, { status: res.status, statusText: res.statusText, headers })
}

/** POST /api/mcp: authenticate, then hand the JSON-RPC request to the MCP server. */
export async function handleMcpPost(req: Request, deps?: McpAuthDeps): Promise<Response> {
  const caller = await resolveMcpCaller(req, deps)
  if (caller instanceof Response) return withCors(caller)
  return withCors(await createMcpServerHandler(caller)(req))
}

/** GET /api/mcp: no server-sent stream in stateless mode. */
export function mcpMethodNotAllowed(): Response {
  return withCors(
    new Response(JSON.stringify({ jsonrpc: '2.0', error: { code: -32000, message: 'Method not allowed' }, id: null }), {
      status: 405,
      headers: { 'content-type': 'application/json', allow: 'POST, OPTIONS' },
    }),
  )
}

export function mcpPreflight(): Response {
  return new Response(null, { status: 204, headers: MCP_CORS_HEADERS })
}
