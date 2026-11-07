import { eq } from 'drizzle-orm'
import { mkdtemp, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import { setNowForTests } from '@/server/core/clock'
import type { Ctx } from '@/server/core/context'
import type { Db } from '@/server/db'
import {
  assignment,
  assignmentAttachment,
  class_,
  classLecturer,
  classStudent,
  course,
  courseRosterAdjustment,
  file,
  school,
  submission,
  submissionFile,
} from '@/server/db/schema'
import { MAX_FILE_BYTES, MAX_FILES } from '@/server/assignments/rules'
import { createClass, joinClassAsLecturer, joinClassAsStudent } from '@/server/classes/service'
import { createCourse, setRosterAdjustment } from '@/server/courses/service'
import { createSchool } from '@/server/schools/service'
import { createTestDb } from '@/test/db'
import { ctxFor, makeUser } from '@/test/factories'
import {
  assertConfirmedFilesOwnedBy,
  authorizeBlobUpload,
  confirmUpload,
  getFileForDownload,
  receiveLocalUpload,
  requestUpload,
} from './service'
import type { UploadTarget } from './storage'

const DAY = 24 * 60 * 60_000
const PDF = 'application/pdf'

function streamOf(data: Uint8Array): ReadableStream<Uint8Array> {
  return new ReadableStream({
    start(controller) {
      controller.enqueue(data)
      controller.close()
    },
  })
}

async function readAll(stream: ReadableStream<Uint8Array>): Promise<number[]> {
  const out: number[] = []
  const reader = stream.getReader()
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    out.push(...value)
  }
  return out
}

/** What the browser does with a local upload target: PUT to the route, which decodes the key. */
function keyOf(target: UploadTarget): string {
  if (target.kind !== 'local') throw new Error('expected a local target')
  const prefix = '/api/uploads/local/'
  expect(target.url.startsWith(prefix)).toBe(true)
  return target.url.slice(prefix.length).split('/').map(decodeURIComponent).join('/')
}

describe('files service', () => {
  let db: Db
  let dir: string
  const savedEnv = { STORAGE_DRIVER: process.env.STORAGE_DRIVER, LOCAL_UPLOAD_DIR: process.env.LOCAL_UPLOAD_DIR }

  beforeAll(async () => {
    db = await createTestDb()
    dir = await mkdtemp(path.join(tmpdir(), 'clasync-files-'))
    process.env.STORAGE_DRIVER = 'local'
    process.env.LOCAL_UPLOAD_DIR = dir
  })
  afterAll(async () => {
    await rm(dir, { recursive: true, force: true })
    for (const [k, v] of Object.entries(savedEnv)) {
      if (v === undefined) delete process.env[k]
      else process.env[k] = v
    }
  })
  afterEach(async () => {
    setNowForTests(null)
    await db.delete(submissionFile)
    await db.delete(submission)
    await db.delete(assignmentAttachment)
    await db.delete(assignment)
    await db.delete(file)
    await db.delete(courseRosterAdjustment)
    await db.delete(course)
    await db.delete(classStudent)
    await db.delete(classLecturer)
    await db.delete(class_)
    await db.delete(school)
  })

  async function setup() {
    const lecturer = ctxFor(db, await makeUser(db, { role: 'lecturer', name: 'Dr Owner' }))
    const sch = await createSchool(lecturer, { name: 'University of Buea', town: 'Buea' })
    const cls = await createClass(lecturer, { schoolId: sch.id, name: 'CS L3', academicYear: '2026/27' })
    const colleague = ctxFor(db, await makeUser(db, { role: 'lecturer', name: 'Dr Colleague' }))
    await joinClassAsLecturer(colleague, cls.lecturerCode!)
    const algo = await createCourse(lecturer, { classId: cls.id, title: 'Algorithms', semester: 1 })
    const alice = ctxFor(db, await makeUser(db, { role: 'student', name: 'Alice' }))
    const bob = ctxFor(db, await makeUser(db, { role: 'student', name: 'Bob' }))
    const outsider = ctxFor(db, await makeUser(db, { role: 'student', name: 'Olga' }))
    await joinClassAsStudent(alice, cls.studentCode!, 'UB1')
    await joinClassAsStudent(bob, cls.studentCode!, 'UB2')
    const published = await makeAssignment(algo.id, lecturer, { status: 'published' })
    const draft = await makeAssignment(algo.id, lecturer, { status: 'draft' })
    return { lecturer, colleague, algo, alice, bob, outsider, published, draft }
  }

  async function makeAssignment(
    courseId: string,
    by: Ctx,
    over: Partial<{ status: 'draft' | 'published'; latePolicy: 'accept' | 'close'; dueAt: Date }> = {},
  ): Promise<string> {
    const [row] = await db
      .insert(assignment)
      .values({
        courseId,
        title: 'Homework',
        dueAt: over.dueAt ?? new Date(Date.now() + 7 * DAY),
        maxMark: 20,
        submissionMode: 'both',
        latePolicy: over.latePolicy ?? 'accept',
        status: over.status ?? 'draft',
        createdBy: by.user.id,
      })
      .returning({ id: assignment.id })
    return row.id
  }

  /** Request, upload (through the local route's service) and confirm a file. */
  async function upload(
    ctx: Ctx,
    purpose: 'assignment' | 'submission',
    assignmentId: string,
    data = new Uint8Array([1, 2, 3, 4]),
    name = 'notes.pdf',
  ) {
    const { fileId, target } = await requestUpload(ctx, { purpose, assignmentId, name, mimeType: PDF, size: data.length })
    await receiveLocalUpload(ctx, keyOf(target), streamOf(data))
    await confirmUpload(ctx, fileId)
    return fileId
  }

  async function submit(student: Ctx, assignmentId: string, fileIds: string[]) {
    const [row] = await db
      .insert(submission)
      .values({ assignmentId, studentId: student.user.id, submittedAt: new Date() })
      .returning({ id: submission.id })
    await db.insert(submissionFile).values(fileIds.map((fileId, i) => ({ submissionId: row.id, fileId, position: i })))
    return row.id
  }

  async function attach(assignmentId: string, fileIds: string[]) {
    await db.insert(assignmentAttachment).values(fileIds.map((fileId, i) => ({ assignmentId, fileId, position: i })))
  }

  async function fileCount() {
    return (await db.select({ id: file.id }).from(file)).length
  }

  it('lecturer requests an attachment upload for their own assignment; a colleague gets FORBIDDEN', async () => {
    const { lecturer, colleague, alice, published, draft } = await setup()
    const input = { purpose: 'assignment' as const, assignmentId: draft, name: 'Brief.PDF', mimeType: PDF, size: 1234 }

    const { fileId, target } = await requestUpload(lecturer, input)
    expect(target).toEqual({ kind: 'local', url: expect.stringMatching(/^\/api\/uploads\/local\//), method: 'PUT' })
    expect(keyOf(target)).toBe(`assignments/${draft}/${fileId}-Brief.PDF`)
    const [row] = await db.select().from(file).where(eq(file.id, fileId))
    expect(row).toMatchObject({
      ownerId: lecturer.user.id,
      purpose: 'assignment',
      name: 'Brief.PDF',
      mimeType: PDF,
      sizeBytes: 1234,
      confirmedAt: null,
    })

    await expect(requestUpload(colleague, input)).rejects.toMatchObject({ code: 'FORBIDDEN' })
    await expect(requestUpload(alice, { ...input, assignmentId: published })).rejects.toMatchObject({ code: 'FORBIDDEN' })
    await expect(requestUpload(lecturer, { ...input, assignmentId: 'no-such-assignment' })).rejects.toMatchObject({
      code: 'FORBIDDEN',
    })
    expect(await fileCount()).toBe(1)
  })

  it('student requests a submission upload only when on the roster and canSubmit is ok', async () => {
    const { lecturer, alice, outsider, algo, published, draft } = await setup()
    const input = { purpose: 'submission' as const, assignmentId: published, name: 'answer.jpg', mimeType: 'image/jpeg', size: 99 }

    const { fileId, target } = await requestUpload(alice, input)
    expect(keyOf(target)).toBe(`submissions/${published}/${alice.user.id}/${fileId}-answer.jpg`)

    await expect(requestUpload(outsider, input)).rejects.toMatchObject({ code: 'FORBIDDEN' })
    await expect(requestUpload(alice, { ...input, assignmentId: draft })).rejects.toMatchObject({ code: 'FORBIDDEN' })
    await expect(requestUpload(lecturer, input)).rejects.toMatchObject({ code: 'FORBIDDEN' })

    // Hard-closed after the deadline → CONFLICT closed; accepted-late stays open.
    const closed = await makeAssignment(algo.id, lecturer, {
      status: 'published',
      latePolicy: 'close',
      dueAt: new Date(Date.now() - DAY),
    })
    await expect(requestUpload(alice, { ...input, assignmentId: closed })).rejects.toMatchObject({
      code: 'CONFLICT',
      details: { reason: 'closed' },
    })
    const lateOk = await makeAssignment(algo.id, lecturer, { status: 'published', dueAt: new Date(Date.now() - DAY) })
    await expect(requestUpload(alice, { ...input, assignmentId: lateOk })).resolves.toMatchObject({ fileId: expect.any(String) })
  })

  it('rejects .exe declared as pdf (type), 20 MB + 1 (size) before creating anything', async () => {
    const { lecturer, alice, published, draft } = await setup()
    await expect(
      requestUpload(alice, { purpose: 'submission', assignmentId: published, name: 'virus.exe', mimeType: PDF, size: 10 }),
    ).rejects.toMatchObject({ code: 'VALIDATION', details: { reason: 'type' } })
    await expect(
      requestUpload(alice, { purpose: 'submission', assignmentId: published, name: 'movie.mp4', mimeType: 'video/mp4', size: 10 }),
    ).rejects.toMatchObject({ code: 'VALIDATION', details: { reason: 'type' } })
    await expect(
      requestUpload(lecturer, {
        purpose: 'assignment',
        assignmentId: draft,
        name: 'big.pdf',
        mimeType: PDF,
        size: MAX_FILE_BYTES + 1,
      }),
    ).rejects.toMatchObject({ code: 'VALIDATION', details: { reason: 'size' } })
    // Malformed input is VALIDATION too, never a crash.
    await expect(
      requestUpload(alice, { purpose: 'other' as 'submission', assignmentId: published, name: 'a.pdf', mimeType: PDF, size: 1 }),
    ).rejects.toMatchObject({ code: 'VALIDATION' })
    await expect(
      requestUpload(alice, { purpose: 'submission', assignmentId: published, name: '', mimeType: PDF, size: 1 }),
    ).rejects.toMatchObject({ code: 'VALIDATION' })
    expect(await fileCount()).toBe(0)
    expect(await readdir(dir)).toEqual([])
  })

  it('keeps storage keys free of user-controlled paths', async () => {
    const { lecturer, draft } = await setup()
    const { fileId, target } = await requestUpload(lecturer, {
      purpose: 'assignment',
      assignmentId: draft,
      name: '../../etc/Énoncé du TP #2.pdf',
      mimeType: PDF,
      size: 10,
    })
    expect(keyOf(target)).toBe(`assignments/${draft}/${fileId}-Enonce-du-TP-2.pdf`)
    const [row] = await db.select({ name: file.name }).from(file).where(eq(file.id, fileId))
    expect(row.name).toBe('Énoncé du TP #2.pdf')
  })

  it('confirmUpload refuses a size mismatch and removes the row and object', async () => {
    const { alice, bob, published } = await setup()
    const { fileId, target } = await requestUpload(alice, {
      purpose: 'submission',
      assignmentId: published,
      name: 'a.pdf',
      mimeType: PDF,
      size: 10,
    })
    // Bob cannot confirm Alice's upload.
    await expect(confirmUpload(bob, fileId)).rejects.toMatchObject({ code: 'FORBIDDEN' })
    // Nothing uploaded yet → mismatch.
    const second = await requestUpload(alice, { purpose: 'submission', assignmentId: published, name: 'b.pdf', mimeType: PDF, size: 3 })
    await expect(confirmUpload(alice, second.fileId)).rejects.toMatchObject({ code: 'VALIDATION', details: { reason: 'mismatch' } })

    // Fewer bytes than declared → mismatch; row and object are gone.
    await receiveLocalUpload(alice, keyOf(target), streamOf(new Uint8Array(4)))
    await expect(confirmUpload(alice, fileId)).rejects.toMatchObject({ code: 'VALIDATION', details: { reason: 'mismatch' } })
    expect(await fileCount()).toBe(0)
    expect(await readdir(path.join(dir, 'submissions', published, alice.user.id))).toEqual([])
    await expect(confirmUpload(alice, fileId)).rejects.toMatchObject({ code: 'FORBIDDEN' })
  })

  it('confirmUpload sets confirmedAt and returns the file info; confirming twice is harmless', async () => {
    const { alice, published } = await setup()
    const at = new Date('2026-11-09T10:00:00Z')
    setNowForTests(() => at)
    const { fileId, target } = await requestUpload(alice, {
      purpose: 'submission',
      assignmentId: published,
      name: 'photo.png',
      mimeType: 'image/png',
      size: 3,
    })
    await receiveLocalUpload(alice, keyOf(target), streamOf(new Uint8Array([9, 9, 9])))
    const info = await confirmUpload(alice, fileId)
    expect(info).toEqual({ id: fileId, name: 'photo.png', mimeType: 'image/png', sizeBytes: 3 })
    const [row] = await db.select({ confirmedAt: file.confirmedAt }).from(file).where(eq(file.id, fileId))
    expect(row.confirmedAt).toEqual(at)
    expect(await confirmUpload(alice, fileId)).toEqual(info)
  })

  it('local upload: only the uploader, only while pending, never more than declared', async () => {
    const { alice, bob, published } = await setup()
    const { fileId, target } = await requestUpload(alice, {
      purpose: 'submission',
      assignmentId: published,
      name: 'a.pdf',
      mimeType: PDF,
      size: 4,
    })
    const key = keyOf(target)
    await expect(receiveLocalUpload(bob, key, streamOf(new Uint8Array(4)))).rejects.toMatchObject({ code: 'FORBIDDEN' })
    await expect(receiveLocalUpload(alice, 'submissions/x/y/z.pdf', streamOf(new Uint8Array(4)))).rejects.toMatchObject({
      code: 'FORBIDDEN',
    })
    await expect(receiveLocalUpload(alice, key, streamOf(new Uint8Array(5)))).rejects.toMatchObject({
      code: 'VALIDATION',
      details: { reason: 'size' },
    })
    expect(await readdir(path.join(dir, 'submissions', published, alice.user.id))).toEqual([])

    await receiveLocalUpload(alice, key, streamOf(new Uint8Array([1, 2, 3, 4])))
    await confirmUpload(alice, fileId)
    // Once confirmed, the content can't be swapped.
    await expect(receiveLocalUpload(alice, key, streamOf(new Uint8Array(4)))).rejects.toMatchObject({ code: 'FORBIDDEN' })
  })

  it('blob token: only for a pending file of the caller, limited to its type and size, no overwrite', async () => {
    const { alice, bob, published } = await setup()
    const { fileId, target } = await requestUpload(alice, {
      purpose: 'submission',
      assignmentId: published,
      name: 'a.pdf',
      mimeType: PDF,
      size: 1234,
    })
    const key = keyOf(target)
    expect(await authorizeBlobUpload(alice, key)).toEqual({
      allowedContentTypes: [PDF],
      maximumSizeInBytes: 1234,
      addRandomSuffix: false,
      allowOverwrite: false,
    })
    await expect(authorizeBlobUpload(bob, key)).rejects.toMatchObject({ code: 'FORBIDDEN' })
    await expect(authorizeBlobUpload(alice, 'submissions/other.pdf')).rejects.toMatchObject({ code: 'FORBIDDEN' })
    await receiveLocalUpload(alice, key, streamOf(new Uint8Array(1234)))
    await confirmUpload(alice, fileId)
    await expect(authorizeBlobUpload(alice, key)).rejects.toMatchObject({ code: 'FORBIDDEN' })
  })

  it('download: uploader ok; course owner ok for submissions; other student FORBIDDEN; colleague FORBIDDEN', async () => {
    const { lecturer, colleague, alice, bob, outsider, published } = await setup()
    const data = new Uint8Array([5, 6, 7])
    const fileId = await upload(alice, 'submission', published, data, 'Mon devoir.pdf')
    await submit(alice, published, [fileId])

    for (const who of [alice, lecturer]) {
      const got = await getFileForDownload(who, fileId)
      expect(got.info).toEqual({ id: fileId, name: 'Mon devoir.pdf', mimeType: PDF, sizeBytes: 3 })
      expect(got.inline).toBe(true)
      expect(await readAll(got.stream)).toEqual([5, 6, 7])
    }
    for (const who of [bob, outsider, colleague]) {
      await expect(getFileForDownload(who, fileId)).rejects.toMatchObject({ code: 'FORBIDDEN' })
    }
    // Unknown id: same answer as "not yours".
    await expect(getFileForDownload(alice, 'no-such-file')).rejects.toMatchObject({ code: 'FORBIDDEN' })
  })

  it('download: an unlinked or unconfirmed file is visible to its uploader only', async () => {
    const { lecturer, alice, bob, published } = await setup()
    const unlinked = await upload(alice, 'submission', published)
    await expect(getFileForDownload(lecturer, unlinked)).rejects.toMatchObject({ code: 'FORBIDDEN' })
    await expect(getFileForDownload(bob, unlinked)).rejects.toMatchObject({ code: 'FORBIDDEN' })
    expect((await getFileForDownload(alice, unlinked)).info.id).toBe(unlinked)

    // Even linked into a submission, an unconfirmed file stays private to its uploader.
    const pending = await requestUpload(alice, { purpose: 'submission', assignmentId: published, name: 'p.pdf', mimeType: PDF, size: 2 })
    await submit(alice, published, [pending.fileId])
    await expect(getFileForDownload(lecturer, pending.fileId)).rejects.toMatchObject({ code: 'FORBIDDEN' })
    await expect(getFileForDownload(bob, pending.fileId)).rejects.toMatchObject({ code: 'FORBIDDEN' })
  })

  it('download: rostered student can read attachments of a published assignment, not a draft', async () => {
    const { lecturer, colleague, alice, outsider, published, draft } = await setup()
    const pubFile = await upload(lecturer, 'assignment', published, new Uint8Array([1]), 'Sujet.pdf')
    const draftFile = await upload(lecturer, 'assignment', draft)
    await attach(published, [pubFile])
    await attach(draft, [draftFile])

    expect(await readAll((await getFileForDownload(alice, pubFile)).stream)).toEqual([1])
    await expect(getFileForDownload(alice, draftFile)).rejects.toMatchObject({ code: 'FORBIDDEN' })
    await expect(getFileForDownload(outsider, pubFile)).rejects.toMatchObject({ code: 'FORBIDDEN' })
    await expect(getFileForDownload(colleague, pubFile)).rejects.toMatchObject({ code: 'FORBIDDEN' })
    expect((await getFileForDownload(lecturer, draftFile)).info.id).toBe(draftFile)
  })

  it('download: Word files are attachments, images inline', async () => {
    const { lecturer, published } = await setup()
    const docx = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
    const cases = [
      { name: 'a.docx', mimeType: docx, inline: false },
      { name: 'a.doc', mimeType: 'application/msword', inline: false },
      { name: 'a.jpg', mimeType: 'image/jpeg', inline: true },
    ]
    for (const c of cases) {
      const { fileId, target } = await requestUpload(lecturer, { purpose: 'assignment', assignmentId: published, name: c.name, mimeType: c.mimeType, size: 1 })
      await receiveLocalUpload(lecturer, keyOf(target), streamOf(new Uint8Array(1)))
      await confirmUpload(lecturer, fileId)
      const got = await getFileForDownload(lecturer, fileId)
      expect(got.inline, c.name).toBe(c.inline)
      await got.stream.cancel()
    }
  })

  it('assertConfirmedFilesOwnedBy rejects an 11th file, a foreign file, an unconfirmed file and a wrong purpose', async () => {
    const { lecturer, alice, bob, published } = await setup()
    const mine: string[] = []
    for (let i = 0; i < 11; i++) mine.push(await upload(alice, 'submission', published, new Uint8Array([i])))
    const ok = (ids: string[]) => assertConfirmedFilesOwnedBy(db, ids, alice.user.id, 'submission', published)

    await expect(ok([])).resolves.toBeUndefined()
    await expect(ok(mine.slice(0, 10))).resolves.toBeUndefined()
    await expect(ok(mine)).rejects.toMatchObject({ code: 'VALIDATION' })
    await expect(ok([mine[0], mine[0]])).rejects.toMatchObject({ code: 'VALIDATION' })

    const foreign = await upload(bob, 'submission', published)
    await expect(ok([mine[0], foreign])).rejects.toMatchObject({ code: 'VALIDATION' })

    const pending = await requestUpload(alice, { purpose: 'submission', assignmentId: published, name: 'p.pdf', mimeType: PDF, size: 2 })
    await expect(ok([mine[0], pending.fileId])).rejects.toMatchObject({ code: 'VALIDATION' })

    const lecturerFile = await upload(lecturer, 'assignment', published)
    await expect(assertConfirmedFilesOwnedBy(db, [lecturerFile], lecturer.user.id, 'submission', published)).rejects.toMatchObject({
      code: 'VALIDATION',
    })
    await expect(assertConfirmedFilesOwnedBy(db, [lecturerFile], lecturer.user.id, 'assignment', published)).resolves.toBeUndefined()
    await expect(ok(['no-such-file'])).rejects.toMatchObject({ code: 'VALIDATION' })
  })

  it('assertConfirmedFilesOwnedBy rejects a confirmed file uploaded for another assignment', async () => {
    const { lecturer, alice, algo, published, draft } = await setup()
    const other = await makeAssignment(algo.id, lecturer, { status: 'published' })
    const forOther = await upload(alice, 'submission', other)
    const forThis = await upload(alice, 'submission', published)
    await expect(assertConfirmedFilesOwnedBy(db, [forThis], alice.user.id, 'submission', published)).resolves.toBeUndefined()
    await expect(assertConfirmedFilesOwnedBy(db, [forThis, forOther], alice.user.id, 'submission', published)).rejects.toMatchObject({
      code: 'VALIDATION',
    })
    const draftAttachment = await upload(lecturer, 'assignment', draft)
    await expect(assertConfirmedFilesOwnedBy(db, [draftAttachment], lecturer.user.id, 'assignment', published)).rejects.toMatchObject({
      code: 'VALIDATION',
    })
    await expect(assertConfirmedFilesOwnedBy(db, [draftAttachment], lecturer.user.id, 'assignment', draft)).resolves.toBeUndefined()
    // A prefix is matched exactly: LIKE wildcards in the id match nothing.
    await expect(assertConfirmedFilesOwnedBy(db, [forThis], alice.user.id, 'submission', '%')).rejects.toMatchObject({
      code: 'VALIDATION',
    })
  })

  it('download: a link only counts when the file was uploaded for that assignment (and student)', async () => {
    const { lecturer, colleague, alice, bob, published, draft } = await setup()
    // An attachment uploaded for the draft, linked into the published assignment: students can't read it.
    const draftFile = await upload(lecturer, 'assignment', draft)
    await attach(published, [draftFile])
    await expect(getFileForDownload(alice, draftFile)).rejects.toMatchObject({ code: 'FORBIDDEN' })

    // Alice's file linked into Bob's submission: neither Bob nor the lecturer gains access.
    const aliceFile = await upload(alice, 'submission', published)
    await submit(bob, published, [aliceFile])
    await expect(getFileForDownload(bob, aliceFile)).rejects.toMatchObject({ code: 'FORBIDDEN' })
    await expect(getFileForDownload(lecturer, aliceFile)).rejects.toMatchObject({ code: 'FORBIDDEN' })

    // Alice's file for this course, linked into her submission in the colleague's course.
    const [{ classId }] = await db.select({ classId: course.classId }).from(course)
    const colleagueCourse = await createCourse(colleague, { classId, title: 'Networks', semester: 1 })
    const theirs = await makeAssignment(colleagueCourse.id, colleague, { status: 'published' })
    const aliceOther = await upload(alice, 'submission', published)
    await submit(alice, theirs, [aliceOther])
    await expect(getFileForDownload(colleague, aliceOther)).rejects.toMatchObject({ code: 'FORBIDDEN' })
  })

  it('download: an excluded student cannot read a published attachment', async () => {
    const { lecturer, alice, bob, algo, published } = await setup()
    const fileId = await upload(lecturer, 'assignment', published)
    await attach(published, [fileId])
    await setRosterAdjustment(lecturer, algo.id, bob.user.id, 'exclude')
    await expect(getFileForDownload(bob, fileId)).rejects.toMatchObject({ code: 'FORBIDDEN' })
    expect((await getFileForDownload(alice, fileId)).info.id).toBe(fileId)
  })

  it('caps pending uploads: 2 × MAX_FILES unconfirmed in the last 24 h → CONFLICT too_many_pending', async () => {
    const { alice, published } = await setup()
    const at = new Date('2026-11-09T10:00:00Z')
    setNowForTests(() => at)
    const req = (n: number) =>
      requestUpload(alice, { purpose: 'submission', assignmentId: published, name: `p${n}.pdf`, mimeType: PDF, size: 2 })
    for (let i = 0; i < 2 * MAX_FILES - 1; i++) await req(i)
    // A confirmed file and an old pending one don't count.
    await db.insert(file).values({
      ownerId: alice.user.id,
      purpose: 'submission',
      storageKey: `submissions/${published}/${alice.user.id}/old`,
      name: 'old.pdf',
      mimeType: PDF,
      sizeBytes: 2,
      createdAt: new Date(at.getTime() - DAY - 1000),
    })
    await upload(alice, 'submission', published)
    await req(100)
    await expect(req(101)).rejects.toMatchObject({ code: 'CONFLICT', details: { reason: 'too_many_pending' } })
    // A day later the window has moved on.
    setNowForTests(() => new Date(at.getTime() + DAY + 1000))
    await expect(req(102)).resolves.toMatchObject({ fileId: expect.any(String) })
  })

  it('cleans display names: bidi and C1 controls go, lone surrogates become U+FFFD', async () => {
    const { lecturer, draft } = await setup()
    const nameOf = async (raw: string) => {
      const { fileId } = await requestUpload(lecturer, { purpose: 'assignment', assignmentId: draft, name: raw, mimeType: PDF, size: 1 })
      const [row] = await db.select({ name: file.name }).from(file).where(eq(file.id, fileId))
      return row.name
    }
    expect(await nameOf('invoice\u202Efdp.exe\u202C.pdf')).toBe('invoicefdp.exe.pdf')
    expect(await nameOf('a\u2066b\u2067c\u2068d\u2069e\u202Af\u202Bg\u202Dh.pdf')).toBe('abcdefgh.pdf')
    expect(await nameOf('x\u0085y\u009Fz\u0080.pdf')).toBe('xyz.pdf')
    expect(await nameOf('lone\uD800half.pdf')).toBe('lone\uFFFDhalf.pdf')
    expect(await nameOf('ok \uD83D\uDCDA.pdf')).toBe('ok \uD83D\uDCDA.pdf')
  })
})
