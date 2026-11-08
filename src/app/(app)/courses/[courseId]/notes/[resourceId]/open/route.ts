import { getCtx } from '@/server/auth/session'
import { errorResponse } from '@/server/files/http'
import { openItem } from '@/server/notes/read'

/** Records the view, then sends the browser to the file or the link. Errors say nothing beyond the code. */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ courseId: string; resourceId: string }> },
): Promise<Response> {
  try {
    const { courseId, resourceId } = await params
    const target = await openItem(await getCtx(), courseId, resourceId)
    const location = target.kind === 'file' ? `/api/files/${encodeURIComponent(target.fileId)}` : target.url
    return new Response(null, { status: 302, headers: { Location: location, 'Cache-Control': 'no-store' } })
  } catch (err) {
    return errorResponse(err)
  }
}
