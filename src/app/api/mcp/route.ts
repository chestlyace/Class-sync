import { handleMcpPost, mcpMethodNotAllowed, mcpPreflight } from '@/server/mcp/http'

// MCP endpoint for lecturers' AI assistants (streamable HTTP, stateless). Auth: OAuth access token
// bound to this URL, or a personal access token (`Bearer cls_…`).
export const runtime = 'nodejs'
export const maxDuration = 60
export const dynamic = 'force-dynamic'

export async function POST(req: Request) {
  return handleMcpPost(req)
}

export async function GET() {
  return mcpMethodNotAllowed()
}

export async function DELETE() {
  return mcpMethodNotAllowed()
}

export async function OPTIONS() {
  return mcpPreflight()
}
