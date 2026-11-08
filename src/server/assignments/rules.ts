export const MAX_FILE_BYTES = 20 * 1024 * 1024
export const MAX_FILES = 10
export const MAX_RICH_TEXT_BYTES = 200_000
export const MARK_STEP = 0.25
export const REMINDER_LEAD_HOURS = 24

/** Accepted upload types and the file extensions (lowercase, no dot) each may carry. */
const EXTENSIONS_BY_MIME = {
  'application/pdf': ['pdf'],
  'application/msword': ['doc'],
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': ['docx'],
  'image/jpeg': ['jpg', 'jpeg'],
  'image/png': ['png'],
  'image/webp': ['webp'],
  'image/heic': ['heic'],
  'image/heif': ['heif', 'heic'],
} as const satisfies Record<string, readonly string[]>

export type AllowedMimeType = keyof typeof EXTENSIONS_BY_MIME

export const ALLOWED_MIME_TYPES = Object.keys(EXTENSIONS_BY_MIME) as AllowedMimeType[]

export function extensionsFor(mime: string): string[] {
  // `mime` is client-declared: only own keys count ('constructor', '__proto__', ... must not match).
  const key = mime.trim().toLowerCase()
  if (!Object.hasOwn(EXTENSIONS_BY_MIME, key)) return []
  return [...(EXTENSIONS_BY_MIME as Record<string, readonly string[]>)[key]]
}

/** Checks the declared type, then that the extension matches it, then the size. */
export function isAllowedFile(name: string, mimeType: string, size: number): 'ok' | 'type' | 'size' {
  const allowed = extensionsFor(mimeType)
  const dot = name.lastIndexOf('.')
  const ext = dot >= 0 ? name.slice(dot + 1).toLowerCase() : ''
  if (allowed.length === 0 || !allowed.includes(ext)) return 'type'
  if (!Number.isFinite(size) || size <= 0 || size > MAX_FILE_BYTES) return 'size'
  return 'ok'
}

/** A mark is a multiple of MARK_STEP between 0 and maxMark inclusive. */
export function isValidMark(mark: number, maxMark: number): boolean {
  if (!Number.isFinite(mark) || mark < 0 || mark > maxMark) return false
  return Number.isInteger(mark / MARK_STEP)
}

export function isLate(submittedAt: Date, dueAt: Date): boolean {
  return submittedAt.getTime() > dueAt.getTime()
}

/**
 * Whether work can be handed in now: only on a published assignment, never once grades are
 * released (ruling B9: a resubmission would wipe the released mark), and after the deadline only
 * under the `accept` late policy.
 */
export function canSubmit(input: {
  status: 'draft' | 'published'
  latePolicy: 'accept' | 'close'
  dueAt: Date
  gradesReleasedAt: Date | null
  now: Date
}): 'ok' | 'not_published' | 'released' | 'closed' {
  if (input.status !== 'published') return 'not_published'
  if (input.gradesReleasedAt !== null) return 'released'
  if (input.latePolicy === 'close' && isLate(input.now, input.dueAt)) return 'closed'
  return 'ok'
}
