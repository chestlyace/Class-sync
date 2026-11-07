import { createBlobDriver, type BlobDriver } from './blob-driver'
import { createLocalDriver, type LocalDriver } from './local-driver'

/** Where the browser sends the bytes of a requested upload. */
export type UploadTarget =
  | { kind: 'blob'; pathname: string; handleUploadUrl: '/api/uploads/blob' }
  | { kind: 'local'; url: string; method: 'PUT' }

/**
 * One storage backend. Keys are built by the files service (never from user-controlled paths
 * beyond a sanitised file name). Reading a missing object throws `AppError('NOT_FOUND')`.
 */
export type StorageDriver = {
  kind: 'blob' | 'local'
  uploadTarget(key: string, contentType: string): Promise<UploadTarget>
  stat(key: string): Promise<{ size: number } | null>
  read(key: string): Promise<ReadableStream<Uint8Array>>
  remove(key: string): Promise<void>
}

export const DEFAULT_LOCAL_UPLOAD_DIR = '.uploads'

/**
 * The active driver, from the environment on every call (cheap; lets tests switch it):
 * `STORAGE_DRIVER=local|blob`, otherwise local outside production when no `BLOB_READ_WRITE_TOKEN`
 * is set, and Vercel Blob (private) everywhere else.
 */
export function getStorage(): BlobDriver | LocalDriver {
  const explicit = process.env.STORAGE_DRIVER?.trim()
  let kind: 'local' | 'blob'
  if (explicit) {
    if (explicit !== 'local' && explicit !== 'blob') {
      throw new Error(`STORAGE_DRIVER must be "local" or "blob", got "${explicit}"`)
    }
    kind = explicit
  } else {
    kind = process.env.NODE_ENV !== 'production' && !process.env.BLOB_READ_WRITE_TOKEN ? 'local' : 'blob'
  }
  if (kind === 'blob') return createBlobDriver()
  return createLocalDriver(process.env.LOCAL_UPLOAD_DIR || DEFAULT_LOCAL_UPLOAD_DIR)
}
