import { BlobNotFoundError, del, get, head } from '@vercel/blob'
import { AppError } from '@/server/core/errors'
import type { StorageDriver } from './storage'

export const BLOB_HANDLE_UPLOAD_URL = '/api/uploads/blob' as const

/**
 * Vercel Blob, private store. Uploads go straight from the browser (`upload()` from
 * `@vercel/blob/client`, token from `/api/uploads/blob`); reads stream through our file route.
 * The pathname is the storage key. Credentials come from `BLOB_READ_WRITE_TOKEN`.
 */
export type BlobDriver = StorageDriver & { kind: 'blob' }

export function createBlobDriver(): BlobDriver {
  return {
    kind: 'blob',

    async uploadTarget(key) {
      return { kind: 'blob', pathname: key, handleUploadUrl: BLOB_HANDLE_UPLOAD_URL }
    },

    async stat(key) {
      try {
        const meta = await head(key)
        return { size: meta.size }
      } catch (err) {
        if (err instanceof BlobNotFoundError) return null
        throw err
      }
    },

    async read(key) {
      // Objects are never overwritten (tokens are issued with allowOverwrite: false), so the
      // CDN-cached copy is always current.
      const result = await get(key, { access: 'private' })
      if (!result || result.statusCode !== 200) throw new AppError('NOT_FOUND', 'File content is missing')
      return result.stream
    },

    async remove(key) {
      await del(key)
    },
  }
}
