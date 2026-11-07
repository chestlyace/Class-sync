import { createReadStream } from 'node:fs'
import { mkdir, open, rename, rm, stat } from 'node:fs/promises'
import path from 'node:path'
import { Readable } from 'node:stream'
import { AppError } from '@/server/core/errors'
import type { StorageDriver } from './storage'

export const LOCAL_UPLOAD_ROUTE = '/api/uploads/local/'

export type LocalWriteResult = { ok: true; size: number } | { ok: false; reason: 'too_large' | 'aborted' }

/** Development / e2e storage on the local disk. The browser PUTs to `/api/uploads/local/<key>`. */
export type LocalDriver = StorageDriver & {
  kind: 'local'
  /**
   * Streams `body` to `key`, atomically (temp file + rename). Stops as soon as more than
   * `maxBytes` arrive and leaves nothing behind. `beforeCommit`, when given, is asked once all
   * bytes are in; answering false discards them (`aborted`) and keeps any existing object.
   */
  write(
    key: string,
    body: ReadableStream<Uint8Array>,
    maxBytes: number,
    beforeCommit?: () => Promise<boolean>,
  ): Promise<LocalWriteResult>
}

/** The browser-facing URL for a key; each segment is percent-encoded. */
export function localUploadUrl(key: string): string {
  return LOCAL_UPLOAD_ROUTE + key.split('/').map(encodeURIComponent).join('/')
}

function invalidKey(): never {
  throw new AppError('VALIDATION', 'Invalid storage key', { reason: 'key' })
}

/**
 * Keys are relative, `/`-separated, with no empty, `.` or `..` segment, no backslash and no NUL.
 * The resolved path must also stay inside the upload root (belt and braces).
 */
function resolveKey(root: string, key: string): string {
  if (typeof key !== 'string' || key.length === 0 || key.length > 1024) invalidKey()
  if (key.includes('\\') || key.includes('\0') || key.startsWith('/') || path.isAbsolute(key)) invalidKey()
  if (/^[a-zA-Z]:/.test(key)) invalidKey()
  for (const segment of key.split('/')) {
    if (segment === '' || segment === '.' || segment === '..') invalidKey()
  }
  const full = path.resolve(root, key)
  if (!full.startsWith(root + path.sep)) invalidKey()
  return full
}

function isNotFound(err: unknown): boolean {
  return typeof err === 'object' && err !== null && (err as { code?: unknown }).code === 'ENOENT'
}

export function createLocalDriver(dir: string): LocalDriver {
  const root = path.resolve(dir)

  return {
    kind: 'local',

    async uploadTarget(key) {
      resolveKey(root, key)
      return { kind: 'local', url: localUploadUrl(key), method: 'PUT' }
    },

    async stat(key) {
      const full = resolveKey(root, key)
      try {
        const s = await stat(full)
        return s.isFile() ? { size: s.size } : null
      } catch (err) {
        if (isNotFound(err)) return null
        throw err
      }
    },

    async read(key) {
      const full = resolveKey(root, key)
      let handle
      try {
        handle = await open(full, 'r')
      } catch (err) {
        if (isNotFound(err)) throw new AppError('NOT_FOUND', 'File content is missing')
        throw err
      }
      // The read stream owns the handle and closes it when done or cancelled.
      const nodeStream = createReadStream('', { fd: handle })
      return Readable.toWeb(nodeStream) as unknown as ReadableStream<Uint8Array>
    },

    async remove(key) {
      const full = resolveKey(root, key)
      await rm(full, { force: true })
    },

    async write(key, body, maxBytes, beforeCommit) {
      const full = resolveKey(root, key)
      await mkdir(path.dirname(full), { recursive: true })
      const temp = `${full}.${crypto.randomUUID()}.part`
      const handle = await open(temp, 'wx')
      const reader = body.getReader()
      let size = 0
      let finished = false
      try {
        for (;;) {
          const { done, value } = await reader.read()
          if (done) break
          size += value.byteLength
          if (size > maxBytes) {
            await reader.cancel().catch(() => {})
            return { ok: false, reason: 'too_large' }
          }
          let offset = 0
          while (offset < value.byteLength) {
            const { bytesWritten } = await handle.write(value, offset)
            offset += bytesWritten
          }
        }
        await handle.sync()
        await handle.close()
        if (beforeCommit && !(await beforeCommit())) {
          await rm(temp, { force: true })
          finished = true
          return { ok: false, reason: 'aborted' }
        }
        await rename(temp, full)
        finished = true
        return { ok: true, size }
      } finally {
        if (!finished) {
          await handle.close().catch(() => {})
          await rm(temp, { force: true })
        }
        reader.releaseLock()
      }
    },
  }
}
