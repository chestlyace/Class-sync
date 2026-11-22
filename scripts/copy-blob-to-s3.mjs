// Copies every file from the Vercel Blob store to the S3 bucket under the same key (the storage keys in
// the database stay valid). Files already in the bucket are skipped, so it can run again after a failure.
// Run once at cutover, on the Heroku app that already has S3 set up:
//
//   heroku config:set BLOB_READ_WRITE_TOKEN=<the production Blob store's token> -a clasync
//   heroku run node scripts/copy-blob-to-s3.mjs -a clasync
//   heroku config:unset BLOB_READ_WRITE_TOKEN -a clasync
import { get, list } from '@vercel/blob'
import { HeadObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3'

const bucket = process.env.S3_BUCKET
if (!process.env.BLOB_READ_WRITE_TOKEN || !bucket) {
  console.error('BLOB_READ_WRITE_TOKEN and S3_BUCKET must be set')
  process.exit(1)
}
const s3 = new S3Client({ region: process.env.S3_REGION || 'eu-west-3', requestChecksumCalculation: 'WHEN_REQUIRED' })

async function inBucket(key) {
  try {
    await s3.send(new HeadObjectCommand({ Bucket: bucket, Key: key }))
    return true
  } catch (err) {
    if (err?.$metadata?.httpStatusCode === 404) return false
    throw err
  }
}

let copied = 0, skipped = 0, failed = 0, bytes = 0
let cursor
do {
  const page = await list({ cursor, limit: 500 })
  for (const blob of page.blobs) {
    try {
      if (await inBucket(blob.pathname)) {
        skipped++
        continue
      }
      const res = await get(blob.pathname, { access: 'private' })
      if (!res || res.statusCode !== 200) throw new Error(`Blob read answered ${res?.statusCode}`)
      const body = Buffer.from(await new Response(res.stream).arrayBuffer())
      await s3.send(new PutObjectCommand({
        Bucket: bucket,
        Key: blob.pathname,
        Body: body,
        ContentType: res.blob.contentType,
      }))
      copied++
      bytes += body.length
    } catch (err) {
      failed++
      console.error('Could not copy', blob.pathname, err?.message ?? err)
    }
  }
  cursor = page.hasMore ? page.cursor : undefined
} while (cursor)

console.log(`Copied ${copied} (${(bytes / 1e6).toFixed(1)} MB), already there ${skipped}, failed ${failed}`)
if (failed > 0) process.exitCode = 1
