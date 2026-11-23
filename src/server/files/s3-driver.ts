import { DeleteObjectCommand, GetObjectCommand, HeadObjectCommand, PutObjectCommand, S3Client, S3ServiceException } from '@aws-sdk/client-s3'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'
import { AppError } from '@/server/core/errors'
import type { StorageDriver } from './storage'

/** How long a browser has to start sending the bytes once the upload is requested. */
export const S3_UPLOAD_URL_TTL_SECONDS = 600

/**
 * Amazon S3, private bucket (Heroku). Uploads go straight from the browser with a presigned PUT; reads
 * stream through our file route. The object key is the storage key.
 * Settings: `S3_BUCKET`, `S3_REGION` (default eu-west-3); credentials from the standard AWS variables
 * (`AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`). The bucket needs a CORS rule allowing PUT from the site.
 */
export type S3Driver = StorageDriver & { kind: 's3' }

type Env = Record<string, string | undefined>

const globalForS3 = globalThis as typeof globalThis & { __clasyncS3?: { key: string; client: S3Client } }

function client(region: string): S3Client {
  const cached = globalForS3.__clasyncS3
  if (cached && cached.key === region) return cached.client
  // WHEN_REQUIRED: otherwise the SDK signs a checksum of the (empty) presign body into upload URLs,
  // and S3 refuses every browser upload.
  const created = new S3Client({ region, requestChecksumCalculation: 'WHEN_REQUIRED' })
  globalForS3.__clasyncS3 = { key: region, client: created }
  return created
}

function isNotFound(err: unknown): boolean {
  return err instanceof S3ServiceException && (err.name === 'NotFound' || err.name === 'NoSuchKey' || err.$metadata?.httpStatusCode === 404)
}

export function createS3Driver(env: Env = process.env): S3Driver {
  const bucket = env.S3_BUCKET?.trim()
  if (!bucket) throw new Error('S3_BUCKET is not set')
  const s3 = client(env.S3_REGION?.trim() || 'eu-west-3')

  return {
    kind: 's3',

    /**
     * A URL that accepts exactly this object once: the type and size are signed, and `If-None-Match: *`
     * makes S3 refuse to replace an object that already exists, so a confirmed file can't be swapped
     * later with a leftover URL.
     */
    async uploadTarget(key, contentType, size) {
      const url = await getSignedUrl(
        s3,
        new PutObjectCommand({ Bucket: bucket, Key: key, ContentType: contentType, ContentLength: size, IfNoneMatch: '*' }),
        {
          expiresIn: S3_UPLOAD_URL_TTL_SECONDS,
          signableHeaders: new Set(['content-type', 'content-length', 'if-none-match']),
        },
      )
      return { kind: 's3', url, method: 'PUT', headers: { 'Content-Type': contentType, 'If-None-Match': '*' } }
    },

    async stat(key) {
      try {
        const meta = await s3.send(new HeadObjectCommand({ Bucket: bucket, Key: key }))
        return { size: meta.ContentLength ?? 0 }
      } catch (err) {
        if (isNotFound(err)) return null
        throw err
      }
    },

    async read(key) {
      try {
        const result = await s3.send(new GetObjectCommand({ Bucket: bucket, Key: key }))
        if (!result.Body) throw new AppError('NOT_FOUND', 'File content is missing')
        return result.Body.transformToWebStream() as ReadableStream<Uint8Array>
      } catch (err) {
        if (isNotFound(err)) throw new AppError('NOT_FOUND', 'File content is missing')
        throw err
      }
    },

    async remove(key) {
      await s3.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }))
    },
  }
}
