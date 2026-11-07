import { and, eq, inArray, isNotNull, isNull } from 'drizzle-orm'
import { z } from 'zod'
import { canSubmit, isAllowedFile, MAX_FILES } from '@/server/assignments/rules'
import { now } from '@/server/core/clock'
import type { Ctx } from '@/server/core/context'
import { AppError } from '@/server/core/errors'
import { requireRole, requireVerified } from '@/server/core/guards'
import { isOnCourseRoster, requireCourseOwner } from '@/server/courses/service'
import type { Db } from '@/server/db'
import {
  assignment,
  assignmentAttachment,
  course,
  file,
  FILE_PURPOSES,
  type FilePurpose,
  submission,
  submissionFile,
} from '@/server/db/schema'
import { getStorage, type UploadTarget } from './storage'

export type FileInfo = { id: string; name: string; mimeType: string; sizeBytes: number }

const MAX_NAME_LENGTH = 255
const MAX_SAFE_NAME_LENGTH = 100

const requestSchema = z.object({
  purpose: z.enum(FILE_PURPOSES),
  assignmentId: z.string().min(1).max(100),
  name: z.string().max(1000),
  mimeType: z.string().max(200),
  size: z.number(),
})

function forbidden(message = 'You do not have access to this file'): never {
  throw new AppError('FORBIDDEN', message)
}

/** The display name: the last path component, without control characters, NFC. */
function cleanName(raw: string): string {
  const base = raw.split(/[/\\]/).pop() ?? ''
  return base.replace(/[\u0000-\u001f\u007f]/g, '').normalize('NFC').trim()
}

/** The file-name part of a storage key: ASCII letters, digits, `.`, `_` and `-` only. */
export function safeName(name: string): string {
  const ascii = name
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^A-Za-z0-9._-]+/g, '-')
    .replace(/-{2,}/g, '-')
    .replace(/^[-.]+|-+$/g, '')
  const dot = ascii.lastIndexOf('.')
  const ext = dot > 0 ? ascii.slice(dot) : ''
  const stem = (dot > 0 ? ascii.slice(0, dot) : ascii).replace(/[-.]+$/g, '') || 'file'
  return stem.slice(0, MAX_SAFE_NAME_LENGTH - ext.length) + ext
}

function toInfo(row: { id: string; name: string; mimeType: string; sizeBytes: number }): FileInfo {
  return { id: row.id, name: row.name, mimeType: row.mimeType, sizeBytes: row.sizeBytes }
}

async function loadAssignment(db: Db, assignmentId: string) {
  const [row] = await db
    .select({
      id: assignment.id,
      courseId: assignment.courseId,
      status: assignment.status,
      latePolicy: assignment.latePolicy,
      dueAt: assignment.dueAt,
    })
    .from(assignment)
    .where(eq(assignment.id, assignmentId))
  return row
}

/**
 * Step 1 of an upload: checks who may upload where and what, creates an unconfirmed `file` row and
 * says where the browser sends the bytes.
 * - `assignment` (an attachment): the caller owns the assignment's course.
 * - `submission`: the caller is a rostered student and the assignment takes submissions now.
 * "No such assignment" and "not yours" are both FORBIDDEN.
 */
export async function requestUpload(
  ctx: Ctx,
  input: { purpose: FilePurpose; assignmentId: string; name: string; mimeType: string; size: number },
): Promise<{ fileId: string; target: UploadTarget }> {
  const parsed = requestSchema.safeParse(input)
  if (!parsed.success) {
    const fields = [...new Set(parsed.error.issues.map((i) => i.path.join('.')))]
    throw new AppError('VALIDATION', 'Invalid input', { fields })
  }
  const data = parsed.data
  const name = cleanName(data.name)
  if (name.length === 0 || name.length > MAX_NAME_LENGTH) {
    throw new AppError('VALIDATION', 'Invalid file name', { fields: ['name'] })
  }
  const mimeType = data.mimeType.trim().toLowerCase()

  const asg = await loadAssignment(ctx.db, data.assignmentId)
  if (data.purpose === 'assignment') {
    requireRole(ctx, 'lecturer')
    if (!asg) forbidden('Only the lecturer of this course can do this')
    await requireCourseOwner(ctx, asg.courseId)
  } else {
    requireRole(ctx, 'student')
    if (!asg || !(await isOnCourseRoster(ctx.db, asg.courseId, ctx.user.id))) forbidden('Not on this course')
    const verdict = canSubmit({ status: asg.status, latePolicy: asg.latePolicy, dueAt: asg.dueAt, now: now() })
    if (verdict === 'not_published') forbidden('Not on this course')
    if (verdict === 'closed') throw new AppError('CONFLICT', 'Submissions are closed', { reason: 'closed' })
  }

  const allowed = isAllowedFile(name, mimeType, data.size)
  if (allowed !== 'ok') throw new AppError('VALIDATION', 'File not accepted', { reason: allowed })
  // isAllowedFile accepts any finite size in range; the column is an integer.
  if (!Number.isSafeInteger(data.size)) throw new AppError('VALIDATION', 'File not accepted', { reason: 'size' })

  const fileId = crypto.randomUUID()
  const leaf = `${fileId}-${safeName(name)}`
  const storageKey =
    data.purpose === 'assignment' ? `assignments/${asg.id}/${leaf}` : `submissions/${asg.id}/${ctx.user.id}/${leaf}`
  const target = await getStorage().uploadTarget(storageKey, mimeType)
  await ctx.db.insert(file).values({
    id: fileId,
    ownerId: ctx.user.id,
    purpose: data.purpose,
    storageKey,
    name,
    mimeType,
    sizeBytes: data.size,
  })
  return { fileId, target }
}

/** The caller's own file row, still waiting for its bytes (or undefined). */
async function pendingFileByKey(ctx: Ctx, storageKey: string) {
  const [row] = await ctx.db
    .select({ id: file.id, mimeType: file.mimeType, sizeBytes: file.sizeBytes })
    .from(file)
    .where(and(eq(file.storageKey, storageKey), eq(file.ownerId, ctx.user.id), isNull(file.confirmedAt)))
  return row
}

/**
 * Step 3 of an upload: the stored object must exist and have exactly the declared size. Otherwise
 * the object and the row are removed and VALIDATION { reason: 'mismatch' } is thrown.
 * Confirming an already confirmed file returns its info again.
 */
export async function confirmUpload(ctx: Ctx, fileId: string): Promise<FileInfo> {
  requireVerified(ctx)
  const [row] = await ctx.db
    .select()
    .from(file)
    .where(and(eq(file.id, fileId), eq(file.ownerId, ctx.user.id)))
  if (!row) forbidden()
  if (row.confirmedAt) return toInfo(row)

  const storage = getStorage()
  const stored = await storage.stat(row.storageKey)
  if (!stored || stored.size !== row.sizeBytes) {
    try {
      await storage.remove(row.storageKey)
    } catch (err) {
      // The row goes anyway, so the object can never be read; a cleanup job can sweep it later.
      console.error('[files] could not remove a mismatched upload', row.storageKey, err)
    }
    await ctx.db.delete(file).where(and(eq(file.id, row.id), isNull(file.confirmedAt)))
    throw new AppError('VALIDATION', 'Uploaded file does not match what was declared', { reason: 'mismatch' })
  }
  await ctx.db
    .update(file)
    .set({ confirmedAt: now() })
    .where(and(eq(file.id, row.id), isNull(file.confirmedAt)))
  return toInfo(row)
}

/**
 * Step 2 with the local driver (`PUT /api/uploads/local/<key>`): only the uploader, only while the
 * file is unconfirmed, never more bytes than declared (VALIDATION { reason: 'size' }).
 */
export async function receiveLocalUpload(ctx: Ctx, key: string, body: ReadableStream<Uint8Array>): Promise<void> {
  const storage = getStorage()
  if (storage.kind !== 'local') throw new AppError('NOT_FOUND', 'Local uploads are disabled')
  requireVerified(ctx)
  const row = await pendingFileByKey(ctx, key)
  if (!row) forbidden()
  const result = await storage.write(key, body, row.sizeBytes, async () => !!(await pendingFileByKey(ctx, key)))
  if (!result.ok) {
    if (result.reason === 'too_large') {
      throw new AppError('VALIDATION', 'More bytes than declared', { reason: 'size' })
    }
    // Confirmed (or deleted) while the bytes were still arriving: the stored object stays as it was.
    forbidden()
  }
}

/**
 * Step 2 with Vercel Blob: the options for a client token (`onBeforeGenerateToken`). Issued only
 * for the caller's own unconfirmed file at exactly that pathname, limited to its declared type and
 * size; never overwrites, so a confirmed object can't be swapped later with a leftover token.
 */
export async function authorizeBlobUpload(
  ctx: Ctx,
  pathname: string,
): Promise<{ allowedContentTypes: string[]; maximumSizeInBytes: number; addRandomSuffix: false; allowOverwrite: false }> {
  requireVerified(ctx)
  const row = await pendingFileByKey(ctx, pathname)
  if (!row) forbidden()
  return {
    allowedContentTypes: [row.mimeType],
    maximumSizeInBytes: row.sizeBytes,
    addRandomSuffix: false,
    allowOverwrite: false,
  }
}

/**
 * Who may read a file:
 * - its uploader (even before it is confirmed);
 * - for an assignment attachment: the course owner, or a rostered student once the assignment
 *   is published;
 * - for a submission file: the submitting student or the course owner.
 * A link only counts in the link table that matches the file's purpose (a submission file wrongly
 * linked as an attachment does not become visible to the class). Everything else, including other
 * people's unconfirmed files, is refused.
 */
async function mayRead(ctx: Ctx, row: { id: string; ownerId: string; purpose: FilePurpose; confirmedAt: Date | null }) {
  const me = ctx.user.id
  if (row.ownerId === me) return true
  if (!row.confirmedAt) return false

  if (row.purpose === 'assignment') {
    const links = await ctx.db
      .select({ courseId: course.id, lecturerId: course.lecturerId, status: assignment.status })
      .from(assignmentAttachment)
      .innerJoin(assignment, eq(assignment.id, assignmentAttachment.assignmentId))
      .innerJoin(course, eq(course.id, assignment.courseId))
      .where(eq(assignmentAttachment.fileId, row.id))
    for (const link of links) {
      if (link.lecturerId === me) return true
      if (ctx.user.role === 'student' && link.status === 'published' && (await isOnCourseRoster(ctx.db, link.courseId, me))) {
        return true
      }
    }
    return false
  }

  const links = await ctx.db
    .select({ studentId: submission.studentId, lecturerId: course.lecturerId })
    .from(submissionFile)
    .innerJoin(submission, eq(submission.id, submissionFile.submissionId))
    .innerJoin(assignment, eq(assignment.id, submission.assignmentId))
    .innerJoin(course, eq(course.id, assignment.courseId))
    .where(eq(submissionFile.fileId, row.id))
  return links.some((link) => link.studentId === me || link.lecturerId === me)
}

/** PDFs and images open in the browser; Word files download. */
function isInline(mimeType: string): boolean {
  return mimeType === 'application/pdf' || mimeType.startsWith('image/')
}

/** The only way file contents are read. "No such file" and "not yours" are both FORBIDDEN. */
export async function getFileForDownload(
  ctx: Ctx,
  fileId: string,
): Promise<{ info: FileInfo; stream: ReadableStream<Uint8Array>; inline: boolean }> {
  requireVerified(ctx)
  if (typeof fileId !== 'string' || fileId.length === 0 || fileId.length > 100) forbidden()
  const [row] = await ctx.db.select().from(file).where(eq(file.id, fileId))
  if (!row || !(await mayRead(ctx, row))) forbidden()
  const stream = await getStorage().read(row.storageKey)
  return { info: toInfo(row), stream, inline: isInline(row.mimeType) }
}

/**
 * For attaching files to an assignment or a submission: at most MAX_FILES distinct ids, each a
 * confirmed file of `ownerId` uploaded for `purpose`. Otherwise VALIDATION.
 */
export async function assertConfirmedFilesOwnedBy(
  db: Db,
  fileIds: string[],
  ownerId: string,
  purpose: FilePurpose,
): Promise<void> {
  if (!Array.isArray(fileIds) || fileIds.length > MAX_FILES) {
    throw new AppError('VALIDATION', `At most ${MAX_FILES} files`, { reason: 'count' })
  }
  if (fileIds.some((id) => typeof id !== 'string') || new Set(fileIds).size !== fileIds.length) {
    throw new AppError('VALIDATION', 'Duplicate or invalid file ids', { reason: 'files' })
  }
  if (fileIds.length === 0) return
  const rows = await db
    .select({ id: file.id })
    .from(file)
    .where(
      and(
        inArray(file.id, fileIds),
        eq(file.ownerId, ownerId),
        eq(file.purpose, purpose),
        isNotNull(file.confirmedAt),
      ),
    )
  if (rows.length !== fileIds.length) {
    throw new AppError('VALIDATION', 'Some files are not available', { reason: 'files' })
  }
}
