import { asc, eq } from 'drizzle-orm'
import sharp from 'sharp'
import { richTextPlainText } from '@/lib/rich-text-content'
import type { Db } from '@/server/db'
import { assignment, file, submission, submissionFile, type UnreadFile } from '@/server/db/schema'
import { getStorage } from '@/server/files/storage'

/** At most this many images and documents go to the model; the rest are reported as not read. */
const MAX_IMAGES = 20
const MAX_DOCUMENTS = 5
/** A PDF or Word file over this size is not sent (the model's request size is limited). */
const MAX_DOCUMENT_BYTES = 4.5 * 1024 * 1024
/** An image at or under both of these goes to the model untouched. */
const IMAGE_AS_IS_BYTES = 3.5 * 1024 * 1024
const IMAGE_MAX_SIDE = 2000
const IMAGE_JPEG_QUALITY = 80

const IMAGE_MIMES = new Set(['image/jpeg', 'image/png', 'image/webp'])
const DOCUMENT_MIMES = new Set([
  'application/pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
])
const HEIC_MIMES = new Set(['image/heic', 'image/heif'])

export type MarkingFile = { position: number; mimeType: string; sizeBytes: number; storageKey: string }

/**
 * Decides which submitted files the model will read and why each of the others is skipped.
 * `position` is the 1-based place in the hand-in; `unread` comes back sorted by it.
 */
export function planFiles(files: MarkingFile[]): {
  images: MarkingFile[]
  documents: MarkingFile[]
  unread: UnreadFile[]
} {
  const images: MarkingFile[] = []
  const documents: MarkingFile[] = []
  const unread: UnreadFile[] = []
  for (const f of files) {
    const mime = f.mimeType.trim().toLowerCase()
    if (IMAGE_MIMES.has(mime)) {
      if (images.length < MAX_IMAGES) images.push(f)
      else unread.push({ position: f.position, reason: 'limit' })
    } else if (DOCUMENT_MIMES.has(mime)) {
      if (f.sizeBytes > MAX_DOCUMENT_BYTES) unread.push({ position: f.position, reason: 'too_large' })
      else if (documents.length < MAX_DOCUMENTS) documents.push(f)
      else unread.push({ position: f.position, reason: 'limit' })
    } else if (HEIC_MIMES.has(mime)) {
      unread.push({ position: f.position, reason: 'heic' })
    } else {
      unread.push({ position: f.position, reason: 'unsupported' })
    }
  }
  unread.sort((a, b) => a.position - b.position)
  return { images, documents, unread }
}

/**
 * A photo as the model should see it: untouched when it is small enough in bytes and pixels,
 * otherwise scaled down to 2,000 px on its longer side and re-encoded as JPEG. Throws when the
 * bytes are not a readable image.
 */
export async function prepareImage(
  bytes: Uint8Array,
  mimeType: string,
): Promise<{ data: Uint8Array; mediaType: string }> {
  const meta = await sharp(bytes).metadata()
  const longest = Math.max(meta.width ?? 0, meta.height ?? 0)
  if (bytes.byteLength <= IMAGE_AS_IS_BYTES && longest <= IMAGE_MAX_SIDE) {
    return { data: bytes, mediaType: mimeType }
  }
  const out = await sharp(bytes)
    .rotate() // honour the phone's orientation tag before it is dropped
    .resize({ width: IMAGE_MAX_SIDE, height: IMAGE_MAX_SIDE, fit: 'inside', withoutEnlargement: true })
    .flatten({ background: '#ffffff' }) // JPEG has no transparency
    .jpeg({ quality: IMAGE_JPEG_QUALITY })
    .toBuffer()
  return { data: new Uint8Array(out), mediaType: 'image/jpeg' }
}

/** Everything the model sees about a submission. No student name, matricule or file name. */
export type MarkingInput = {
  title: string
  instructions: string
  markingGuide: string | null
  maxMark: number
  studentText: string | null
  images: { position: number; data: Uint8Array; mediaType: string }[]
  documents: { position: number; data: Uint8Array; mediaType: string }[]
}

async function readFromStorage(key: string): Promise<Uint8Array> {
  const stream = await getStorage().read(key)
  return new Uint8Array(await new Response(stream).arrayBuffer())
}

/**
 * Reads one submission into model input. Null when the submission no longer exists. A file that
 * cannot be fetched or decoded is reported as `unsupported` instead of failing the whole read.
 * `read` is injectable for tests; by default it reads from the configured storage.
 */
export async function loadMarkingInput(
  db: Db,
  submissionId: string,
  read: (key: string) => Promise<Uint8Array> = readFromStorage,
): Promise<{ input: MarkingInput; unread: UnreadFile[]; lecturerId: string } | null> {
  const [row] = await db
    .select({
      text: submission.text,
      title: assignment.title,
      instructions: assignment.instructions,
      markingGuide: assignment.markingGuide,
      maxMark: assignment.maxMark,
      createdBy: assignment.createdBy,
    })
    .from(submission)
    .innerJoin(assignment, eq(assignment.id, submission.assignmentId))
    .where(eq(submission.id, submissionId))
    .limit(1)
  if (!row) return null

  const fileRows = await db
    .select({ mimeType: file.mimeType, sizeBytes: file.sizeBytes, storageKey: file.storageKey })
    .from(submissionFile)
    .innerJoin(file, eq(file.id, submissionFile.fileId))
    .where(eq(submissionFile.submissionId, submissionId))
    .orderBy(asc(submissionFile.position))
  const files: MarkingFile[] = fileRows.map((f, i) => ({ ...f, position: i + 1 }))

  const plan = planFiles(files)
  const unread = [...plan.unread]

  const images: MarkingInput['images'] = []
  for (const f of plan.images) {
    try {
      const prepared = await prepareImage(await read(f.storageKey), f.mimeType)
      images.push({ position: f.position, ...prepared })
    } catch {
      unread.push({ position: f.position, reason: 'unsupported' })
    }
  }
  const documents: MarkingInput['documents'] = []
  for (const f of plan.documents) {
    try {
      documents.push({ position: f.position, data: await read(f.storageKey), mediaType: f.mimeType.trim().toLowerCase() })
    } catch {
      unread.push({ position: f.position, reason: 'unsupported' })
    }
  }
  unread.sort((a, b) => a.position - b.position)

  const studentText = row.text == null ? '' : richTextPlainText(row.text).trim()
  const guide = row.markingGuide?.trim()
  return {
    input: {
      title: row.title,
      instructions: richTextPlainText(row.instructions).trim(),
      markingGuide: guide ? guide : null,
      maxMark: row.maxMark,
      studentText: studentText ? studentText : null,
      images,
      documents,
    },
    unread,
    lecturerId: row.createdBy,
  }
}
