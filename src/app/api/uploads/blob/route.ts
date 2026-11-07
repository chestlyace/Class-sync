import { handleUpload, type HandleUploadBody } from '@vercel/blob/client'
import { getCtx } from '@/server/auth/session'
import { AppError } from '@/server/core/errors'
import { errorResponse } from '@/server/files/http'
import { authorizeBlobUpload } from '@/server/files/service'
import { getStorage } from '@/server/files/storage'

/**
 * Client-upload token endpoint for Vercel Blob (`upload(pathname, file, { access: 'private',
 * handleUploadUrl: '/api/uploads/blob' })` in the browser). A token is issued only for the caller's
 * own pending file at that exact pathname, with its declared type and size and no overwrite.
 * Upload-completed callbacks are not used: the browser calls confirmUpload instead.
 */
export async function POST(request: Request) {
  try {
    if (getStorage().kind !== 'blob') throw new AppError('NOT_FOUND')
    const ctx = await getCtx()
    let body: HandleUploadBody
    try {
      body = (await request.json()) as HandleUploadBody
    } catch {
      throw new AppError('VALIDATION', 'Invalid body', { reason: 'body' })
    }
    if (body?.type !== 'blob.generate-client-token') {
      throw new AppError('VALIDATION', 'Unsupported event', { reason: 'body' })
    }
    const result = await handleUpload({
      body,
      request,
      onBeforeGenerateToken: (pathname) => authorizeBlobUpload(ctx, pathname),
    })
    return Response.json(result, { headers: { 'Cache-Control': 'no-store' } })
  } catch (err) {
    return errorResponse(err)
  }
}
