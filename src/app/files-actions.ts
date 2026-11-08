'use server'

import { toActionResult, type ActionResult } from '@/lib/action-result'
import { getCtx } from '@/server/auth/session'
import { AppError } from '@/server/core/errors'
import { confirmUpload, requestUpload, type FileInfo, type UploadInput } from '@/server/files/service'
import type { UploadTarget } from '@/server/files/storage'

const PURPOSES = ['assignment', 'submission', 'resource'] as const

/** Shared by lecturers (assignment attachments, resource files) and students (submission files). */
export type UploadRequest = UploadInput

function invalid(fields: string[]): never {
  throw new AppError('VALIDATION', 'Invalid input', { fields })
}

function parseRequest(raw: unknown): UploadRequest {
  const input = (typeof raw === 'object' && raw !== null ? raw : {}) as Record<string, unknown>
  const bad: string[] = []
  const purpose = input.purpose as (typeof PURPOSES)[number]
  if (!PURPOSES.includes(purpose)) bad.push('purpose')
  const needsAssignment = purpose !== 'resource'
  if (needsAssignment && (typeof input.assignmentId !== 'string' || input.assignmentId === '')) bad.push('assignmentId')
  if (typeof input.name !== 'string') bad.push('name')
  if (typeof input.mimeType !== 'string') bad.push('mimeType')
  if (typeof input.size !== 'number' || !Number.isFinite(input.size)) bad.push('size')
  if (bad.length > 0) invalid(bad)
  const file = { name: input.name as string, mimeType: input.mimeType as string, size: input.size as number }
  if (purpose === 'resource') return { purpose, ...file }
  return { purpose, assignmentId: input.assignmentId as string, ...file }
}

/** Step 1: registers the file and says where the browser sends its bytes. */
export async function requestUploadAction(
  input: UploadRequest,
): Promise<ActionResult<{ fileId: string; target: UploadTarget }>> {
  return toActionResult(async () => requestUpload(await getCtx(), parseRequest(input)))
}

/** Step 3: checks the stored bytes match the declaration; the file can then be attached. */
export async function confirmUploadAction(fileId: string): Promise<ActionResult<FileInfo>> {
  return toActionResult(async () => {
    if (typeof fileId !== 'string' || fileId === '') invalid(['fileId'])
    return confirmUpload(await getCtx(), fileId)
  })
}
