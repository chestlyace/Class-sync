import { asc, eq, inArray } from 'drizzle-orm'
import type { Locale } from '@/server/core/context'
import type { Db } from '@/server/db'
import { assignment, assignmentAttachment, file, submissionFile, user } from '@/server/db/schema'
import type { FileInfo } from '@/server/files/service'
import type { Block } from './rich-text'

/** An assignment as both roles see it (students only ever get published ones). */
export type AssignmentDetail = {
  id: string
  courseId: string
  title: string
  instructions: Block[]
  dueAt: Date
  maxMark: number
  weight: number
  submissionMode: 'files' | 'text' | 'both'
  latePolicy: 'accept' | 'close'
  status: 'draft' | 'published'
  publishedAt: Date | null
  gradesReleasedAt: Date | null
  attachments: FileInfo[]
}

export type AssignmentRow = typeof assignment.$inferSelect

const fileInfoColumns = { id: file.id, name: file.name, mimeType: file.mimeType, sizeBytes: file.sizeBytes }

export async function loadAssignmentRow(db: Db, assignmentId: string): Promise<AssignmentRow | undefined> {
  if (typeof assignmentId !== 'string' || assignmentId.length === 0) return undefined
  const [row] = await db.select().from(assignment).where(eq(assignment.id, assignmentId))
  return row
}

/** Attachments of several assignments at once, each list in its stored order. */
export async function loadAttachmentsByAssignment(db: Db, assignmentIds: string[]): Promise<Map<string, FileInfo[]>> {
  const out = new Map<string, FileInfo[]>(assignmentIds.map((id) => [id, []]))
  if (assignmentIds.length === 0) return out
  const rows = await db
    .select({ assignmentId: assignmentAttachment.assignmentId, ...fileInfoColumns })
    .from(assignmentAttachment)
    .innerJoin(file, eq(file.id, assignmentAttachment.fileId))
    .where(inArray(assignmentAttachment.assignmentId, assignmentIds))
    .orderBy(asc(assignmentAttachment.position), asc(file.id))
  for (const { assignmentId, ...info } of rows) out.get(assignmentId)?.push(info)
  return out
}

/** The files of a submission, in their stored order. */
export async function loadSubmissionFiles(db: Db, submissionId: string): Promise<FileInfo[]> {
  return db
    .select(fileInfoColumns)
    .from(submissionFile)
    .innerJoin(file, eq(file.id, submissionFile.fileId))
    .where(eq(submissionFile.submissionId, submissionId))
    .orderBy(asc(submissionFile.position), asc(file.id))
}

export function toAssignmentDetail(row: AssignmentRow, attachments: FileInfo[]): AssignmentDetail {
  return {
    id: row.id,
    courseId: row.courseId,
    title: row.title,
    // Sanitised on every write (sanitizeRichText), so the stored value is a block list.
    instructions: Array.isArray(row.instructions) ? (row.instructions as Block[]) : [],
    dueAt: row.dueAt,
    maxMark: row.maxMark,
    weight: row.weight,
    submissionMode: row.submissionMode,
    latePolicy: row.latePolicy,
    status: row.status,
    publishedAt: row.publishedAt,
    gradesReleasedAt: row.gradesReleasedAt,
    attachments,
  }
}

export async function loadAssignmentDetail(db: Db, row: AssignmentRow): Promise<AssignmentDetail> {
  const attachments = await loadAttachmentsByAssignment(db, [row.id])
  return toAssignmentDetail(row, attachments.get(row.id) ?? [])
}

/** Each user's email language (unknown values fall back to English). */
export async function localesOf(db: Db, userIds: string[]): Promise<Map<string, Locale>> {
  if (userIds.length === 0) return new Map()
  const rows = await db.select({ id: user.id, locale: user.locale }).from(user).where(inArray(user.id, userIds))
  return new Map(rows.map((r) => [r.id, r.locale === 'fr' ? 'fr' : 'en']))
}

/**
 * Builds links to assignment pages for emails. Without BETTER_AUTH_URL the links are relative and
 * one warning is logged per builder (i.e. per batch of emails), never per recipient.
 */
export function assignmentLinkBuilder(context: string): (assignmentId: string) => string {
  const base = (process.env.BETTER_AUTH_URL ?? '').replace(/\/+$/, '')
  if (!base) console.warn(`[${context}] BETTER_AUTH_URL is not set: notification emails will carry relative links`)
  return (assignmentId) => `${base}/assignments/${encodeURIComponent(assignmentId)}`
}
