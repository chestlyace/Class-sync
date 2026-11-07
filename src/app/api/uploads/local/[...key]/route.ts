import { getCtx } from '@/server/auth/session'
import { AppError } from '@/server/core/errors'
import { errorResponse } from '@/server/files/http'
import { receiveLocalUpload } from '@/server/files/service'
import { getStorage } from '@/server/files/storage'

/**
 * Development / e2e uploads with the local disk driver (404 when Vercel Blob is active). The
 * signed-in uploader PUTs the raw bytes for their own pending file; more than declared → 413.
 */
export async function PUT(request: Request, { params }: RouteContext<'/api/uploads/local/[...key]'>) {
  try {
    if (getStorage().kind !== 'local') throw new AppError('NOT_FOUND')
    const { key } = await params
    const ctx = await getCtx()
    if (!request.body) throw new AppError('VALIDATION', 'Missing body', { reason: 'empty' })
    await receiveLocalUpload(ctx, key.join('/'), request.body)
    return new Response(null, { status: 204, headers: { 'Cache-Control': 'no-store' } })
  } catch (err) {
    return errorResponse(err)
  }
}
