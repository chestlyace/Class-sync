import sharp from 'sharp'
import { afterEach, beforeAll, describe, expect, it } from 'vitest'
import type { Db } from '@/server/db'
import {
  assignment,
  class_,
  classLecturer,
  classStudent,
  course,
  file,
  school,
  submission,
  submissionFile,
} from '@/server/db/schema'
import { createClass, joinClassAsStudent } from '@/server/classes/service'
import { createCourse } from '@/server/courses/service'
import { createSchool } from '@/server/schools/service'
import { createTestDb } from '@/test/db'
import { ctxFor, makeUser } from '@/test/factories'
import { loadMarkingInput, planFiles, prepareImage, type MarkingFile } from './inputs'

const PDF = 'application/pdf'
const DOCX = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
const MB = 1024 * 1024

function f(position: number, mimeType: string, sizeBytes = 1000): MarkingFile {
  return { position, mimeType, sizeBytes, storageKey: `k${position}` }
}

const para = (text: string) => [{ type: 'paragraph', content: [{ type: 'text', text, styles: {} }] }]

describe('planFiles', () => {
  it('keeps the first 20 images and marks the rest as over the limit', () => {
    const files = Array.from({ length: 22 }, (_, i) => f(i + 1, 'image/jpeg'))
    const plan = planFiles(files)
    expect(plan.images.map((x) => x.position)).toEqual(Array.from({ length: 20 }, (_, i) => i + 1))
    expect(plan.documents).toEqual([])
    expect(plan.unread).toEqual([
      { position: 21, reason: 'limit' },
      { position: 22, reason: 'limit' },
    ])
  })

  it('keeps the first 5 documents and marks the rest as over the limit', () => {
    const files = [f(1, PDF), f(2, DOCX), f(3, PDF), f(4, PDF), f(5, DOCX), f(6, PDF)]
    const plan = planFiles(files)
    expect(plan.documents.map((x) => x.position)).toEqual([1, 2, 3, 4, 5])
    expect(plan.unread).toEqual([{ position: 6, reason: 'limit' }])
  })

  it('marks a PDF or DOCX over 4.5 MB as too large (and it does not use a document slot)', () => {
    const plan = planFiles([f(1, PDF, 5 * MB), f(2, DOCX, 4.5 * MB + 1), f(3, PDF, 4.5 * MB)])
    expect(plan.documents.map((x) => x.position)).toEqual([3])
    expect(plan.unread).toEqual([
      { position: 1, reason: 'too_large' },
      { position: 2, reason: 'too_large' },
    ])
  })

  it('marks HEIC and HEIF as heic, and anything else as unsupported', () => {
    const plan = planFiles([f(1, 'image/heic'), f(2, 'image/heif'), f(3, 'application/zip'), f(4, 'application/msword')])
    expect(plan.unread).toEqual([
      { position: 1, reason: 'heic' },
      { position: 2, reason: 'heic' },
      { position: 3, reason: 'unsupported' },
      { position: 4, reason: 'unsupported' },
    ])
  })

  it('keeps hand-in order across kinds, with unread sorted by position', () => {
    const plan = planFiles([f(1, 'image/png'), f(2, 'application/zip'), f(3, PDF), f(4, 'image/webp'), f(5, 'image/heic')])
    expect(plan.images.map((x) => x.position)).toEqual([1, 4])
    expect(plan.documents.map((x) => x.position)).toEqual([3])
    expect(plan.unread.map((x) => x.position)).toEqual([2, 5])
  })
})

describe('prepareImage', () => {
  it('resizes a wide image to 2000 px on its longer side and returns a JPEG', async () => {
    const png = await sharp({ create: { width: 3000, height: 1000, channels: 3, background: '#336699' } }).png().toBuffer()
    const out = await prepareImage(new Uint8Array(png))
    expect(out.mediaType).toBe('image/jpeg')
    const meta = await sharp(out.data).metadata()
    expect(meta.format).toBe('jpeg')
    expect(meta.width).toBe(2000)
    expect(meta.height).toBe(667)
  })

  it('returns a small image unchanged', async () => {
    const png = new Uint8Array(
      await sharp({ create: { width: 100, height: 100, channels: 3, background: '#ffffff' } }).png().toBuffer(),
    )
    const out = await prepareImage(png)
    expect(out.mediaType).toBe('image/png')
    expect(out.data).toBe(png)
  })

  it('names an unchanged image by what its bytes are', async () => {
    const png = new Uint8Array(
      await sharp({ create: { width: 100, height: 100, channels: 3, background: '#ffffff' } }).png().toBuffer(),
    )
    const out = await prepareImage(png)
    expect(out.mediaType).toBe('image/png')
    expect(out.data).toBe(png)
  })

  it('re-encodes an image over 3.5 MB even when its dimensions are small', async () => {
    const raw = Buffer.alloc(1800 * 1800 * 3)
    for (let i = 0; i < raw.length; i++) raw[i] = (i * 2654435761) >>> 24
    const png = new Uint8Array(await sharp(raw, { raw: { width: 1800, height: 1800, channels: 3 } }).png({ compressionLevel: 0 }).toBuffer())
    expect(png.byteLength).toBeGreaterThan(3.5 * MB)
    const out = await prepareImage(png)
    expect(out.mediaType).toBe('image/jpeg')
    expect(out.data.byteLength).toBeLessThan(png.byteLength)
  })
})

describe('loadMarkingInput', () => {
  let db: Db

  beforeAll(async () => {
    db = await createTestDb()
  })
  afterEach(async () => {
    await db.delete(submissionFile)
    await db.delete(submission)
    await db.delete(assignment)
    await db.delete(file)
    await db.delete(course)
    await db.delete(classStudent)
    await db.delete(classLecturer)
    await db.delete(class_)
    await db.delete(school)
  })

  async function seed(opts: { text?: unknown; guide?: string | null } = {}) {
    const lecturerUser = await makeUser(db, { role: 'lecturer', name: 'Dr Owner' })
    const lecturer = ctxFor(db, lecturerUser)
    const sch = await createSchool(lecturer, { name: 'University of Buea', town: 'Buea' })
    const cls = await createClass(lecturer, { schoolId: sch.id, name: 'CS L3', academicYear: '2026/27' })
    const crs = await createCourse(lecturer, { classId: cls.id, title: 'Algorithms', semester: 1 })
    const studentUser = await makeUser(db, { role: 'student', name: 'Zorglub Unique' })
    await joinClassAsStudent(ctxFor(db, studentUser), cls.studentCode!, 'ZRG001')
    const [a] = await db
      .insert(assignment)
      .values({
        courseId: crs.id,
        title: 'Sorting homework',
        instructions: para('Explain quicksort'),
        markingGuide: opts.guide === undefined ? 'Mention pivot choice' : opts.guide,
        dueAt: new Date('2026-12-01T00:00:00Z'),
        maxMark: 20,
        submissionMode: 'both',
        status: 'published',
        publishedAt: new Date('2026-11-10T00:00:00Z'),
        createdBy: lecturerUser.id,
      })
      .returning({ id: assignment.id })
    const [s] = await db
      .insert(submission)
      .values({
        assignmentId: a.id,
        studentId: studentUser.id,
        text: opts.text === undefined ? para('Quicksort picks a pivot.') : opts.text,
        submittedAt: new Date('2026-11-20T00:00:00Z'),
      })
      .returning({ id: submission.id })
    return { lecturerUser, studentUser, assignmentId: a.id, submissionId: s.id }
  }

  async function attach(s: { studentUser: { id: string }; submissionId: string }, position: number, name: string, mime: string, size = 1000) {
    const [row] = await db
      .insert(file)
      .values({
        ownerId: s.studentUser.id,
        purpose: 'submission',
        storageKey: `submission/${crypto.randomUUID()}/${name}`,
        name,
        mimeType: mime,
        sizeBytes: size,
        confirmedAt: new Date('2026-11-20T00:00:00Z'),
      })
      .returning()
    await db.insert(submissionFile).values({ submissionId: s.submissionId, fileId: row.id, position })
    return row
  }

  it('returns null when the submission is gone', async () => {
    expect(await loadMarkingInput(db, 'nope', async () => new Uint8Array())).toBeNull()
  })

  it('turns rich text into plain text and returns the assignment details', async () => {
    const s = await seed()
    const out = await loadMarkingInput(db, s.submissionId, async () => new Uint8Array())
    expect(out).not.toBeNull()
    expect(out!.lecturerId).toBe(s.lecturerUser.id)
    expect(out!.unread).toEqual([])
    expect(out!.input).toMatchObject({
      title: 'Sorting homework',
      instructions: 'Explain quicksort',
      markingGuide: 'Mention pivot choice',
      maxMark: 20,
      studentText: 'Quicksort picks a pivot.',
      images: [],
      documents: [],
    })
  })

  it('gives null studentText for an empty answer and null markingGuide when none is set', async () => {
    const s = await seed({ text: null, guide: null })
    const out = await loadMarkingInput(db, s.submissionId, async () => new Uint8Array())
    expect(out!.input.studentText).toBeNull()
    expect(out!.input.markingGuide).toBeNull()
  })

  it('reads files in hand-in order, reports unread ones and read failures', async () => {
    const s = await seed()
    const png = new Uint8Array(await sharp({ create: { width: 50, height: 50, channels: 3, background: '#fff' } }).png().toBuffer())
    const img = await attach(s, 1, 'a.png', 'image/png')
    const pdf = await attach(s, 2, 'b.pdf', PDF)
    await attach(s, 3, 'c.heic', 'image/heic')
    const broken = await attach(s, 4, 'd.pdf', PDF)
    const bytes = new Map<string, Uint8Array>([
      [img.storageKey, png],
      [pdf.storageKey, new Uint8Array([1, 2, 3])],
    ])
    const out = await loadMarkingInput(db, s.submissionId, async (key) => {
      if (key === broken.storageKey) throw new Error('gone')
      return bytes.get(key)!
    })
    expect(out!.input.images).toEqual([{ position: 1, data: png, mediaType: 'image/png' }])
    expect(out!.input.documents).toEqual([{ position: 2, data: new Uint8Array([1, 2, 3]), mediaType: PDF }])
    expect(out!.unread).toEqual([
      { position: 3, reason: 'heic' },
      { position: 4, reason: 'unsupported' },
    ])
  })

  it('sends a PNG declared as image/jpeg as image/png', async () => {
    const s = await seed()
    const png = new Uint8Array(
      await sharp({ create: { width: 50, height: 50, channels: 3, background: '#fff' } }).png().toBuffer(),
    )
    await attach(s, 1, 'photo.jpg', 'image/jpeg')
    const out = await loadMarkingInput(db, s.submissionId, async () => png)
    expect(out!.input.images).toEqual([{ position: 1, data: png, mediaType: 'image/png' }])
  })

  it('stops sending files once 15 MB have been prepared and reports the rest as over the limit', async () => {
    const s = await seed()
    const docs = []
    for (let i = 1; i <= 5; i++) docs.push(await attach(s, i, `d${i}.pdf`, PDF, 4 * MB))
    const out = await loadMarkingInput(db, s.submissionId, async () => new Uint8Array(4 * MB))
    expect(out!.input.documents.map((d) => d.position)).toEqual([1, 2, 3])
    expect(out!.unread).toEqual([
      { position: 4, reason: 'limit' },
      { position: 5, reason: 'limit' },
    ])
  })

  it('counts resized image bytes, not the original size, against the 15 MB budget', async () => {
    const s = await seed()
    const png = new Uint8Array(
      await sharp({ create: { width: 100, height: 100, channels: 3, background: '#fff' } }).png().toBuffer(),
    )
    const img = await attach(s, 1, 'a.png', 'image/png', 12 * MB) // declared huge, real bytes tiny
    await attach(s, 2, 'b.pdf', PDF, 4 * MB)
    await attach(s, 3, 'c.pdf', PDF, 4 * MB)
    await attach(s, 4, 'd.pdf', PDF, 4 * MB)
    const out = await loadMarkingInput(db, s.submissionId, async (key) =>
      key === img.storageKey ? png : new Uint8Array(4 * MB),
    )
    expect(out!.input.images.map((i) => i.position)).toEqual([1])
    expect(out!.input.documents.map((d) => d.position)).toEqual([2, 3, 4])
    expect(out!.unread).toEqual([])
  })

  it('never puts the student name, matricule or file name in the model input', async () => {
    const s = await seed()
    const pdf = await attach(s, 1, 'Zorglub.pdf', PDF)
    const out = await loadMarkingInput(db, s.submissionId, async (key) => {
      expect(key).toBe(pdf.storageKey)
      return new Uint8Array([37, 80, 68, 70])
    })
    const json = JSON.stringify(out!.input)
    expect(json).not.toContain('Zorglub')
    expect(json).not.toContain('ZRG001')
    expect(out!.input.documents).toHaveLength(1)
  })
})
