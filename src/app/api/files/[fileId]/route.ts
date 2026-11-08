import { getCtx } from '@/server/auth/session'
import { errorResponse, fileResponse } from '@/server/files/http'
import { getFileForDownload } from '@/server/files/service'

/**
 * The bytes stream through this function (the Blob store is private, so there is no public URL to
 * redirect to). A 20 MB file on a slow phone connection can take minutes, hence the long limit.
 */
export const maxDuration = 300

/**
 * The only way to read an uploaded file. Access is checked on every request (the id is never
 * trusted); 401 signed out, 403 for "no such file" and "not yours" alike.
 */
export async function GET(_request: Request, { params }: RouteContext<'/api/files/[fileId]'>) {
  try {
    const { fileId } = await params
    const ctx = await getCtx()
    return fileResponse(await getFileForDownload(ctx, fileId))
  } catch (err) {
    return errorResponse(err)
  }
}
