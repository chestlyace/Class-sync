import { auth } from '@/server/auth/auth'
import { forwardWellKnown, wellKnownPreflight } from '@/server/mcp/well-known'

export const dynamic = 'force-dynamic'

export async function GET(req: Request) {
  return forwardWellKnown(req, auth.handler)
}

export async function OPTIONS() {
  return wellKnownPreflight()
}
