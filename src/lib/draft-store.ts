import { isRichTextEmpty, type Block } from '@/server/assignments/rich-text'
import { MAX_FILES } from '@/server/assignments/rules'
import type { FileInfo } from '@/server/files/service'

/**
 * Unsent work kept in the browser's localStorage. Every call is safe: no storage (server, some
 * private modes), a throwing accessor, a full quota or corrupted JSON all read as "no draft" and
 * never throw.
 */

export function draftKey(userId: string, assignmentId: string): string {
  return `clasync:draft:${userId}:${assignmentId}`
}

function storage(): Storage | null {
  try {
    return globalThis.localStorage ?? null
  } catch {
    return null
  }
}

export function loadDraft(key: string): unknown | null {
  try {
    const raw = storage()?.getItem(key)
    if (raw == null) return null
    return JSON.parse(raw) as unknown
  } catch {
    return null
  }
}

export function saveDraft(key: string, value: unknown): void {
  try {
    const json = JSON.stringify(value)
    if (json === undefined) return
    storage()?.setItem(key, json)
  } catch {
    // Quota exceeded, storage blocked, or a value JSON can't encode: the draft just isn't kept.
  }
}

export function clearDraft(key: string): void {
  try {
    storage()?.removeItem(key)
  } catch {
    // Nothing to do: a draft we can't remove is one we couldn't read either.
  }
}

/** A student's unsent answer: the typed document and the files uploaded but not yet submitted. */
export type SubmissionDraft = { text: unknown[] | null; files: FileInfo[] }

const MAX_ID_LENGTH = 100

function toFileInfo(value: unknown): FileInfo | null {
  if (typeof value !== 'object' || value === null) return null
  const { id, name, mimeType, sizeBytes } = value as Record<string, unknown>
  if (typeof id !== 'string' || id === '' || id.length > MAX_ID_LENGTH) return null
  if (typeof name !== 'string' || typeof mimeType !== 'string') return null
  if (typeof sizeBytes !== 'number' || !Number.isFinite(sizeBytes) || sizeBytes < 0) return null
  return { id, name, mimeType, sizeBytes }
}

/**
 * A stored value read back as a draft (it may be stale, edited by hand, or from an older version):
 * null unless it is an object whose `text` is a block list or null. Files are kept only in the
 * uploader's `FileInfo` shape, without duplicates, at most MAX_FILES. The server checks the files
 * again on submit.
 */
export function toSubmissionDraft(value: unknown): SubmissionDraft | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null
  const { text, files } = value as Record<string, unknown>
  if (text !== null && !Array.isArray(text)) return null
  const seen = new Set<string>()
  const kept: FileInfo[] = []
  for (const item of Array.isArray(files) ? files : []) {
    const info = toFileInfo(item)
    if (!info || seen.has(info.id)) continue
    seen.add(info.id)
    kept.push(info)
    if (kept.length === MAX_FILES) break
  }
  return { text, files: kept }
}

/** The text as stored on submit: an empty document counts as no text. */
function normalisedText(text: unknown[] | null): string {
  if (!text || isRichTextEmpty(text as Block[])) return 'null'
  return JSON.stringify(text)
}

/** Same typed text (an empty document equals none) and the same files in the same order. */
export function sameDraft(a: SubmissionDraft, b: SubmissionDraft): boolean {
  if (normalisedText(a.text) !== normalisedText(b.text)) return false
  return a.files.length === b.files.length && a.files.every((f, i) => f.id === b.files[i].id)
}
