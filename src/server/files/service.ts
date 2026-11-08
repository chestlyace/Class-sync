import { and, count, eq, gt, inArray, isNotNull, isNull, sql } from 'drizzle-orm'
import { z } from 'zod'
import { canSubmit, isAllowedFile, MAX_FILES } from '@/server/assignments/rules'
import { isAllowedResourceFile } from '@/server/notes/rules'
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
  courseTopic,
  file,
  type FilePurpose,
  resource,
  resourcePlacement,
  submission,
  submissionFile,
} from '@/server/db/schema'
import { getStorage, type UploadTarget } from './storage'

export type FileInfo = { id: string; name: string; mimeType: string; sizeBytes: number }

const MAX_NAME_LENGTH = 255
const MAX_SAFE_NAME_LENGTH = 100
/** Unconfirmed uploads one person may have started in the last PENDING_WINDOW_MS. */
const MAX_PENDING_UPLOADS = 2 * MAX_FILES
/** Ruling B10: one hour, so a stuck client recovers soon while a loop can't pile up rows. */
const PENDING_WINDOW_MS = 60 * 60 * 1000

const fileFields = { name: z.string().max(1000), mimeType: z.string().max(200), size: z.number() }
const requestSchema = z.discriminatedUnion('purpose', [
  z.object({ purpose: z.enum(['assignment', 'submission']), assignmentId: z.string().min(1).max(100), ...fileFields }),
  z.object({ purpose: z.literal('resource'), ...fileFields }),
])

/** What a caller sends to start an upload; a resource file needs no parent, so it carries no assignment. */
export type UploadInput =
  | { purpose: 'assignment' | 'submission'; assignmentId: string; name: string; mimeType: string; size: number }
  | { purpose: 'resource'; name: string; mimeType: string; size: number }

function forbidden(message = 'You do not have access to this file'): never {
  throw new AppError('FORBIDDEN', message)
}

/**
 * The display name: the last path component, well-formed UTF-16 (lone surrogates → U+FFFD),
 * without C0/C1 controls or bidi embedding/override/isolate controls (which can disguise
 * names such as `invoice<RLO>fdp.exe`), NFC.
 */
function cleanName(raw: string): string {
  const base = raw.split(/[/\\]/).pop() ?? ''
  return base
    .toWellFormed()
    .replace(/[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/g, '')
    .normalize('NFC')
    .trim()
}

/**
 * Where files of each purpose live; an assignment or submission file belongs to the assignment in
 * its key, a resource file to its owner (it is uploaded before the item exists).
 */
function keyPrefix(purpose: FilePurpose, assignmentId: string, ownerId: string): string {
  if (purpose === 'resource') return `resources/${ownerId}/`
  return purpose === 'assignment' ? `assignments/${assignmentId}/` : `submissions/${assignmentId}/${ownerId}/`
}

/** The file-name part of a storage key: ASCII letters, digits, `.`, `_` and `-` only. */
export function safeName(name: string): string {
  const ascii = name
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
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
      gradesReleasedAt: assignment.gradesReleasedAt,
    })
    .from(assignment)
    .where(eq(assignment.id, assignmentId))
  return row
}

/**
 * Step 1 of an upload: checks who may upload where and what, creates an unconfirmed `file` row and
 * says where the browser sends the bytes.
 * - `assignment` (an attachment): the caller owns the assignment's course.
 * - `submission`: the caller is a rostered student and the assignment takes submissions now
 *   (CONFLICT { reason: 'closed' } past a hard deadline, { reason: 'released' } once grades are out).
 * - `resource` (a file for course notes): a verified lecturer; no parent needed.
 * "No such assignment" and "not yours" are both FORBIDDEN.
 */
export async function requestUpload(
  ctx: Ctx,
  input: UploadInput,
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

  let allowed: 'ok' | 'type' | 'size'
  let asgId = ''
  if (data.purpose === 'resource') {
    requireRole(ctx, 'lecturer')
    allowed = isAllowedResourceFile(name, mimeType, data.size)
  } else if (data.purpose === 'assignment') {
    requireRole(ctx, 'lecturer')
    const asg = await loadAssignment(ctx.db, data.assignmentId)
    if (!asg) forbidden('Only the lecturer of this course can do this')
    await requireCourseOwner(ctx, asg.courseId)
    asgId = asg.id
    allowed = isAllowedFile(name, mimeType, data.size)
  } else {
    requireRole(ctx, 'student')
    const asg = await loadAssignment(ctx.db, data.assignmentId)
    if (!asg || !(await isOnCourseRoster(ctx.db, asg.courseId, ctx.user.id))) forbidden('Not on this course')
    const verdict = canSubmit({ ...asg, now: now() })
    if (verdict === 'not_published') forbidden('Not on this course')
    if (verdict === 'released') {
      throw new AppError('CONFLICT', 'Grades are released, so submissions are closed', { reason: 'released' })
    }
    if (verdict === 'closed') throw new AppError('CONFLICT', 'Submissions are closed', { reason: 'closed' })
    asgId = asg.id
    allowed = isAllowedFile(name, mimeType, data.size)
  }

  if (allowed !== 'ok') throw new AppError('VALIDATION', 'File not accepted', { reason: allowed })
  // isAllowedFile accepts any finite size in range; the column is an integer.
  if (!Number.isSafeInteger(data.size)) throw new AppError('VALIDATION', 'File not accepted', { reason: 'size' })

  const createdAt = now()
  const [pending] = await ctx.db
    .select({ n: count() })
    .from(file)
    .where(
      and(
        eq(file.ownerId, ctx.user.id),
        isNull(file.confirmedAt),
        gt(file.createdAt, new Date(createdAt.getTime() - PENDING_WINDOW_MS)),
      ),
    )
  if (pending.n >= MAX_PENDING_UPLOADS) {
    throw new AppError('CONFLICT', 'Too many unfinished uploads', { reason: 'too_many_pending' })
  }

  const fileId = crypto.randomUUID()
  const storageKey = `${keyPrefix(data.purpose, asgId, ctx.user.id)}${fileId}-${safeName(name)}`
  const target = await getStorage().uploadTarget(storageKey, mimeType)
  await ctx.db.insert(file).values({
    id: fileId,
    createdAt,
    ownerId: ctx.user.id,
    purpose: data.purpose,
    storageKey,
    name,
    mimeType,
    sizeBytes: data.size,
  })
  return { fileId, target }
}

/**
 * Removes a stored file: the object (a failure is logged, not thrown, so the row still goes) and
 * its row. Callers delete whatever references the row first.
 */
export async function deleteStoredFile(db: Db, fileId: string): Promise<void> {
  const [row] = await db.select({ storageKey: file.storageKey }).from(file).where(eq(file.id, fileId))
  if (!row) return
  try {
    await getStorage().remove(row.storageKey)
  } catch (err) {
    console.error('[files] could not remove a stored object', row.storageKey, err)
  }
  await db.delete(file).where(eq(file.id, fileId))
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
 * - for a submission file: the submitting student or the course owner;
 * - for a resource file: a student rostered on a course that places it in a visible topic.
 * A link only counts in the link table that matches the file's purpose, and only when the file was
 * uploaded for that assignment (and, for a submission, by that student), per its storage key. So a
 * file wrongly linked elsewhere never becomes visible there. Everything else, including other
 * people's unconfirmed files, is refused.
 */
async function mayRead(
  ctx: Ctx,
  row: { id: string; ownerId: string; purpose: FilePurpose; storageKey: string; confirmedAt: Date | null },
) {
  const me = ctx.user.id
  if (row.ownerId === me) return true
  if (!row.confirmedAt) return false

  if (row.purpose === 'assignment') {
    const links = await ctx.db
      .select({
        assignmentId: assignment.id,
        courseId: course.id,
        lecturerId: course.lecturerId,
        status: assignment.status,
      })
      .from(assignmentAttachment)
      .innerJoin(assignment, eq(assignment.id, assignmentAttachment.assignmentId))
      .innerJoin(course, eq(course.id, assignment.courseId))
      .where(eq(assignmentAttachment.fileId, row.id))
    for (const link of links) {
      if (!row.storageKey.startsWith(keyPrefix('assignment', link.assignmentId, row.ownerId))) continue
      if (link.lecturerId === me) return true
      if (ctx.user.role === 'student' && link.status === 'published' && (await isOnCourseRoster(ctx.db, link.courseId, me))) {
        return true
      }
    }
    return false
  }

  if (row.purpose === 'resource') {
    if (ctx.user.role !== 'student' || !row.storageKey.startsWith(keyPrefix('resource', '', row.ownerId))) return false
    // Only through a placement in a visible topic of a course the student is on.
    const placed = await ctx.db
      .select({ courseId: resourcePlacement.courseId })
      .from(resource)
      .innerJoin(resourcePlacement, eq(resourcePlacement.resourceId, resource.id))
      .innerJoin(courseTopic, eq(courseTopic.id, resourcePlacement.topicId))
      .where(and(eq(resource.fileId, row.id), eq(courseTopic.hidden, false)))
    for (const p of placed) if (await isOnCourseRoster(ctx.db, p.courseId, me)) return true
    return false
  }

  const links = await ctx.db
    .select({ assignmentId: submission.assignmentId, studentId: submission.studentId, lecturerId: course.lecturerId })
    .from(submissionFile)
    .innerJoin(submission, eq(submission.id, submissionFile.submissionId))
    .innerJoin(assignment, eq(assignment.id, submission.assignmentId))
    .innerJoin(course, eq(course.id, assignment.courseId))
    .where(eq(submissionFile.fileId, row.id))
  return links.some(
    (link) =>
      row.storageKey.startsWith(keyPrefix('submission', link.assignmentId, link.studentId)) &&
      (link.studentId === me || link.lecturerId === me),
  )
}

/** PDFs and images open in the browser; Word files download. */
function isInline(mimeType: string): boolean {
  return mimeType === 'application/pdf' || mimeType.startsWith('image/')
}

/** The only way file contents are read. "No such file" and "not yours" are both FORBIDDEN. */
export async function getFileForDownload(
  ctx: Ctx,
  fileId: string,
): Promise<{ info: FileInfo; stream: ReadableStream<Uint8Array>; inline: boolean; confirmed: boolean }> {
  requireVerified(ctx)
  if (typeof fileId !== 'string' || fileId.length === 0 || fileId.length > 100) forbidden()
  const [row] = await ctx.db.select().from(file).where(eq(file.id, fileId))
  if (!row || !(await mayRead(ctx, row))) forbidden()
  const stream = await getStorage().read(row.storageKey)
  return { info: toInfo(row), stream, inline: isInline(row.mimeType), confirmed: row.confirmedAt !== null }
}

/**
 * For attaching files to an assignment or a submission: at most MAX_FILES distinct ids, each a
 * confirmed file of `ownerId` uploaded for `purpose` on `assignmentId` (its storage key starts with
 * `assignments/<assignmentId>/` or `submissions/<assignmentId>/<ownerId>/`). Otherwise VALIDATION.
 */
export async function assertConfirmedFilesOwnedBy(
  db: Db,
  fileIds: string[],
  ownerId: string,
  purpose: 'assignment' | 'submission',
  assignmentId: string,
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
        // Exact prefix match (no LIKE, so `%` and `_` in ids are not wildcards).
        sql`starts_with(${file.storageKey}, ${keyPrefix(purpose, assignmentId, ownerId)})`,
      ),
    )
  if (rows.length !== fileIds.length) {
    throw new AppError('VALIDATION', 'Some files are not available', { reason: 'files' })
  }
}

/**
 * For a resource item of kind file: the file must be confirmed, uploaded for `resource` by
 * `ownerId`, and not already used by another item. Otherwise VALIDATION { fields: ['file'] }.
 */
export async function claimResourceFile(db: Pick<Db, 'select'>, fileId: string, ownerId: string): Promise<FileInfo> {
  const bad = () => new AppError('VALIDATION', 'This file is not available', { fields: ['file'] })
  if (typeof fileId !== 'string' || fileId.length === 0 || fileId.length > 100) throw bad()
  const [row] = await db
    .select()
    .from(file)
    .where(and(eq(file.id, fileId), eq(file.ownerId, ownerId), eq(file.purpose, 'resource'), isNotNull(file.confirmedAt)))
  if (!row) throw bad()
  const [used] = await db.select({ id: resource.id }).from(resource).where(eq(resource.fileId, fileId))
  if (used) throw bad()
  return toInfo(row)
}
