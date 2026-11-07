import { describe, expect, it } from 'vitest'
import {
  ALLOWED_MIME_TYPES,
  MARK_STEP,
  MAX_FILE_BYTES,
  MAX_FILES,
  MAX_RICH_TEXT_BYTES,
  REMINDER_LEAD_HOURS,
  canSubmit,
  extensionsFor,
  isAllowedFile,
  isLate,
  isValidMark,
} from './rules'

const dueAt = new Date('2026-11-12T07:00:00Z')
const before = new Date(dueAt.getTime() - 60_000)
const after = new Date(dueAt.getTime() + 60_000)

describe('constants', () => {
  it('match the spec', () => {
    expect(MAX_FILE_BYTES).toBe(20 * 1024 * 1024)
    expect(MAX_FILES).toBe(10)
    expect(MAX_RICH_TEXT_BYTES).toBe(200_000)
    expect(MARK_STEP).toBe(0.25)
    expect(REMINDER_LEAD_HOURS).toBe(24)
    expect(ALLOWED_MIME_TYPES).toHaveLength(8)
  })
})

describe('extensionsFor', () => {
  it('lists extensions per type and is empty for unknown types', () => {
    expect(extensionsFor('application/pdf')).toEqual(['pdf'])
    expect(extensionsFor('image/jpeg')).toEqual(expect.arrayContaining(['jpg', 'jpeg']))
    expect(extensionsFor('video/mp4')).toEqual([])
  })
})

describe('isAllowedFile', () => {
  it('accepts matching name, type and size', () => {
    expect(isAllowedFile('essay.pdf', 'application/pdf', 1_000)).toBe('ok')
    expect(isAllowedFile('photo.HEIC', 'image/heic', 3_000_000)).toBe('ok')
    expect(isAllowedFile('notes.docx', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', 5)).toBe('ok')
    expect(isAllowedFile('old.doc', 'application/msword', 5)).toBe('ok')
    expect(isAllowedFile('a.b.jpeg', 'IMAGE/JPEG', 5)).toBe('ok')
  })
  it('rejects a mismatched extension or unsupported type', () => {
    expect(isAllowedFile('virus.exe', 'application/pdf', 1_000)).toBe('type')
    expect(isAllowedFile('film.mp4', 'video/mp4', 1_000)).toBe('type')
    expect(isAllowedFile('noextension', 'application/pdf', 1_000)).toBe('type')
    expect(isAllowedFile('trailing.', 'application/pdf', 1_000)).toBe('type')
  })
  it('limits size to 20 MB and rejects empty files', () => {
    expect(isAllowedFile('big.pdf', 'application/pdf', MAX_FILE_BYTES)).toBe('ok')
    expect(isAllowedFile('big.pdf', 'application/pdf', MAX_FILE_BYTES + 1)).toBe('size')
    expect(isAllowedFile('empty.pdf', 'application/pdf', 0)).toBe('size')
  })
  it('reports type before size', () => {
    expect(isAllowedFile('big.exe', 'application/pdf', MAX_FILE_BYTES + 1)).toBe('type')
  })
})

describe('isValidMark', () => {
  it('accepts quarter steps within 0..max', () => {
    expect(isValidMark(17.25, 20)).toBe(true)
    expect(isValidMark(0, 20)).toBe(true)
    expect(isValidMark(20, 20)).toBe(true)
    expect(isValidMark(0.75, 20)).toBe(true)
  })
  it('rejects off-step, out-of-range and non-finite marks', () => {
    expect(isValidMark(17.3, 20)).toBe(false)
    expect(isValidMark(20.3, 20)).toBe(false)
    expect(isValidMark(21, 20)).toBe(false)
    expect(isValidMark(-1, 20)).toBe(false)
    expect(isValidMark(Number.NaN, 20)).toBe(false)
    expect(isValidMark(Number.POSITIVE_INFINITY, 20)).toBe(false)
  })
})

describe('isLate', () => {
  it('is late only strictly after the due time', () => {
    expect(isLate(new Date(dueAt.getTime() + 1), dueAt)).toBe(true)
    expect(isLate(dueAt, dueAt)).toBe(false)
    expect(isLate(before, dueAt)).toBe(false)
  })
})

describe('canSubmit', () => {
  it('requires a published assignment', () => {
    expect(canSubmit({ status: 'draft', latePolicy: 'accept', dueAt, now: before })).toBe('not_published')
  })
  it('closes after the deadline only under the close policy', () => {
    expect(canSubmit({ status: 'published', latePolicy: 'close', dueAt, now: after })).toBe('closed')
    expect(canSubmit({ status: 'published', latePolicy: 'accept', dueAt, now: after })).toBe('ok')
    expect(canSubmit({ status: 'published', latePolicy: 'close', dueAt, now: before })).toBe('ok')
    expect(canSubmit({ status: 'published', latePolicy: 'close', dueAt, now: dueAt })).toBe('ok')
  })
})
