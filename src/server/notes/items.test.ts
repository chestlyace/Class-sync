import { eq } from 'drizzle-orm'
import { beforeEach, describe, expect, it } from 'vitest'
import type { Db } from '@/server/db'
import { file, resource, resourcePlacement } from '@/server/db/schema'
import { createTestDb } from '@/test/db'
import {
  createFileItem,
  createLink,
  createNote,
  moveItem,
  removeItem,
  shareItem,
  updateFileItem,
  updateLink,
  updateNote,
} from './items'
import { getCourseNotes, getItemForEdit, getNote } from './read'
import { doc, insertResourceFile, setupNotes } from './test-support'
import { createTopic } from './topics'

let db: Db
let fx: Awaited<ReturnType<typeof setupNotes>>

beforeEach(async () => {
  db = await createTestDb()
  fx = await setupNotes(db)
}, 120_000)

const itemTitles = async (courseId: string, topicId: string) =>
  (await getCourseNotes(fx.lecturer, courseId)).topics.find((t) => t.id === topicId)!.items.map((i) => i.title)

describe('creating items', () => {
  it('sanitises a note body: an unsafe link is unwrapped', async () => {
    const body = [
      {
        type: 'paragraph',
        content: [{ type: 'link', href: 'javascript:alert(1)', content: [{ type: 'text', text: 'click', styles: {} }] }],
      },
    ]
    const { id } = await createNote(fx.lecturer, { courseId: fx.courseA, topicId: fx.topicA, title: 'N', body })
    const note = await getNote(fx.lecturer, fx.courseA, id)
    expect(JSON.stringify(note.body)).not.toContain('javascript')
    expect(JSON.stringify(note.body)).toContain('click')
  })

  it('rejects a bad link url, title, body and file', async () => {
    const base = { courseId: fx.courseA, topicId: fx.topicA }
    await expect(createLink(fx.lecturer, { ...base, title: 'L', url: 'ftp://x' })).rejects.toMatchObject({
      code: 'VALIDATION',
      details: { fields: ['url'] },
    })
    await expect(createLink(fx.lecturer, { ...base, title: '', url: 'https://x.org' })).rejects.toMatchObject({
      details: { fields: ['title'] },
    })
    await expect(createNote(fx.lecturer, { ...base, title: 'N', body: 'not blocks' })).rejects.toMatchObject({
      details: { fields: ['body'] },
    })
    await expect(createFileItem(fx.lecturer, { ...base, title: 'F', fileId: 'missing' })).rejects.toMatchObject({
      details: { fields: ['file'] },
    })
  })

  it('claims a file once and only if it is the owner’s confirmed resource file', async () => {
    const base = { courseId: fx.courseA, topicId: fx.topicA }
    const fileId = await insertResourceFile(db, fx.lecturer)
    await createFileItem(fx.lecturer, { ...base, title: 'Slides', fileId })
    await expect(createFileItem(fx.lecturer, { ...base, title: 'Again', fileId })).rejects.toMatchObject({
      details: { fields: ['file'] },
    })
    const others = await insertResourceFile(db, fx.colleague)
    await expect(createFileItem(fx.lecturer, { ...base, title: 'Theirs', fileId: others })).rejects.toMatchObject({
      details: { fields: ['file'] },
    })
    const [pending] = await db
      .insert(file)
      .values({
        ownerId: fx.lecturer.user.id,
        purpose: 'resource',
        storageKey: `resources/${crypto.randomUUID()}`,
        name: 'p.pdf',
        mimeType: 'application/pdf',
        sizeBytes: 1,
      })
      .returning({ id: file.id })
    await expect(createFileItem(fx.lecturer, { ...base, title: 'P', fileId: pending.id })).rejects.toMatchObject({
      details: { fields: ['file'] },
    })
  })

  it('two items racing for one file: one wins, the other is a VALIDATION on the file', async () => {
    const base = { courseId: fx.courseA, topicId: fx.topicA }
    const fileId = await insertResourceFile(db, fx.lecturer)
    const results = await Promise.allSettled([
      createFileItem(fx.lecturer, { ...base, title: 'One', fileId }),
      createFileItem(fx.lecturer, { ...base, title: 'Two', fileId }),
    ])
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1)
    const lost = results.find((r) => r.status === 'rejected') as PromiseRejectedResult
    expect(lost.reason).toMatchObject({ code: 'VALIDATION', details: { fields: ['file'] } })
    expect(await db.select().from(resource).where(eq(resource.fileId, fileId))).toHaveLength(1)
  })

  it('refuses a topic of another course, a colleague, and a student', async () => {
    await expect(
      createLink(fx.lecturer, { courseId: fx.courseA, topicId: fx.topicB, title: 'L', url: 'https://x.org' }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' })
    await expect(
      createLink(fx.colleague, { courseId: fx.courseA, topicId: fx.topicA, title: 'L', url: 'https://x.org' }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' })
    await expect(
      createNote(fx.alice, { courseId: fx.courseA, topicId: fx.topicA, title: 'L', body: doc('x') }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' })
  })

  it('puts new items last', async () => {
    const base = { courseId: fx.courseA, topicId: fx.topicA }
    await createLink(fx.lecturer, { ...base, title: 'One', url: 'https://one.org' })
    await createLink(fx.lecturer, { ...base, title: 'Two', url: 'https://two.org' })
    expect(await itemTitles(fx.courseA, fx.topicA)).toEqual(['One', 'Two'])
  })
})

describe('moving items', () => {
  it('reorders within a topic and moves to another topic of the same course only', async () => {
    const base = { courseId: fx.courseA, topicId: fx.topicA }
    await createLink(fx.lecturer, { ...base, title: 'One', url: 'https://one.org' })
    const two = await createLink(fx.lecturer, { ...base, title: 'Two', url: 'https://two.org' })
    await moveItem(fx.lecturer, { resourceId: two.id, courseId: fx.courseA, dir: 'up' })
    expect(await itemTitles(fx.courseA, fx.topicA)).toEqual(['Two', 'One'])
    await moveItem(fx.lecturer, { resourceId: two.id, courseId: fx.courseA, dir: 'up' })
    expect(await itemTitles(fx.courseA, fx.topicA)).toEqual(['Two', 'One'])
    const other = await createTopic(fx.lecturer, fx.courseA, { title: 'Other' })
    await moveItem(fx.lecturer, { resourceId: two.id, courseId: fx.courseA, topicId: other.id })
    expect(await itemTitles(fx.courseA, other.id)).toEqual(['Two'])
    await expect(
      moveItem(fx.lecturer, { resourceId: two.id, courseId: fx.courseA, topicId: fx.topicB }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' })
  })
})

describe('shared items', () => {
  it('an edit in one course shows in the other; sharing twice conflicts', async () => {
    const { id } = await createNote(fx.lecturer, { courseId: fx.courseA, topicId: fx.topicA, title: 'Old', body: doc('x') })
    await shareItem(fx.lecturer, { resourceId: id, targetCourseId: fx.courseB, targetTopicId: fx.topicB })
    await updateNote(fx.lecturer, id, { title: 'New', body: doc('y') })
    expect((await getNote(fx.lecturer, fx.courseB, id)).title).toBe('New')
    await expect(
      shareItem(fx.lecturer, { resourceId: id, targetCourseId: fx.courseB, targetTopicId: fx.topicB }),
    ).rejects.toMatchObject({ code: 'CONFLICT', details: { reason: 'already_there' } })
    expect((await getNote(fx.lecturer, fx.courseA, id)).alsoIn).toHaveLength(1)
    const edit = await getItemForEdit(fx.lecturer, fx.courseB, id)
    expect(edit.alsoIn).toHaveLength(1)
    expect(edit.topicId).toBe(fx.topicB)
    const listing = await getCourseNotes(fx.lecturer, fx.courseA)
    expect(listing.topics.find((t) => t.id === fx.topicA)!.items[0].sharedInCount).toBe(1)
  })

  it('refuses a target topic of the wrong course and a colleague', async () => {
    const { id } = await createNote(fx.lecturer, { courseId: fx.courseA, topicId: fx.topicA, title: 'N', body: doc('x') })
    await expect(
      shareItem(fx.lecturer, { resourceId: id, targetCourseId: fx.courseB, targetTopicId: fx.topicA }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' })
    await expect(
      shareItem(fx.colleague, { resourceId: id, targetCourseId: fx.courseB, targetTopicId: fx.topicB }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' })
    await expect(updateNote(fx.colleague, id, { title: 'Hijack', body: doc('z') })).rejects.toMatchObject({
      code: 'FORBIDDEN',
    })
  })

  it('removing from one course keeps the item elsewhere; the last removal deletes it and its file', async () => {
    const fileId = await insertResourceFile(db, fx.lecturer)
    const { id } = await createFileItem(fx.lecturer, { courseId: fx.courseA, topicId: fx.topicA, title: 'F', fileId })
    await shareItem(fx.lecturer, { resourceId: id, targetCourseId: fx.courseB, targetTopicId: fx.topicB })
    expect(await removeItem(fx.lecturer, { resourceId: id, courseId: fx.courseA })).toEqual({ deleted: false })
    expect(await itemTitles(fx.courseB, fx.topicB)).toEqual(['F'])
    expect(await db.select().from(file).where(eq(file.id, fileId))).toHaveLength(1)
    expect(await removeItem(fx.lecturer, { resourceId: id, courseId: fx.courseB })).toEqual({ deleted: true })
    expect(await db.select().from(resource).where(eq(resource.id, id))).toHaveLength(0)
    expect(await db.select().from(resourcePlacement).where(eq(resourcePlacement.resourceId, id))).toHaveLength(0)
    expect(await db.select().from(file).where(eq(file.id, fileId))).toHaveLength(0)
  })

  it('removing something not placed in the course is FORBIDDEN', async () => {
    const { id } = await createNote(fx.lecturer, { courseId: fx.courseA, topicId: fx.topicA, title: 'N', body: doc('x') })
    await expect(removeItem(fx.lecturer, { resourceId: id, courseId: fx.courseB })).rejects.toMatchObject({
      code: 'FORBIDDEN',
    })
  })
})

describe('updating links and files', () => {
  it('updates a link and refuses a bad url', async () => {
    const { id } = await createLink(fx.lecturer, {
      courseId: fx.courseA,
      topicId: fx.topicA,
      title: 'L',
      url: 'https://one.org',
    })
    await updateLink(fx.lecturer, id, { title: 'L2', url: 'https://two.org/x' })
    expect((await getItemForEdit(fx.lecturer, fx.courseA, id)).url).toBe('https://two.org/x')
    await expect(updateLink(fx.lecturer, id, { title: 'L2', url: 'javascript:1' })).rejects.toMatchObject({
      details: { fields: ['url'] },
    })
  })

  it('replacing a file deletes the old one; keeping it just renames', async () => {
    const first = await insertResourceFile(db, fx.lecturer, 'a.pdf')
    const { id } = await createFileItem(fx.lecturer, { courseId: fx.courseA, topicId: fx.topicA, title: 'F', fileId: first })
    await updateFileItem(fx.lecturer, id, { title: 'Renamed' })
    expect((await getItemForEdit(fx.lecturer, fx.courseA, id)).file?.id).toBe(first)
    const second = await insertResourceFile(db, fx.lecturer, 'b.pdf')
    await updateFileItem(fx.lecturer, id, { title: 'Renamed', fileId: second })
    expect((await getItemForEdit(fx.lecturer, fx.courseA, id)).file?.id).toBe(second)
    expect(await db.select().from(file).where(eq(file.id, first))).toHaveLength(0)
    await expect(updateFileItem(fx.lecturer, id, { title: 'x', fileId: 'nope' })).rejects.toMatchObject({
      details: { fields: ['file'] },
    })
  })

  it('a replace that races a removal fails FORBIDDEN and keeps the new file unclaimed', async () => {
    const first = await insertResourceFile(db, fx.lecturer, 'a.pdf')
    const { id } = await createFileItem(fx.lecturer, { courseId: fx.courseA, topicId: fx.topicA, title: 'F', fileId: first })
    const second = await insertResourceFile(db, fx.lecturer, 'b.pdf')
    await removeItem(fx.lecturer, { resourceId: id, courseId: fx.courseA })
    await expect(updateFileItem(fx.lecturer, id, { title: 'F', fileId: second })).rejects.toMatchObject({
      code: 'FORBIDDEN',
    })
    expect(await db.select().from(file).where(eq(file.id, second))).toHaveLength(1)
    expect(await db.select().from(resource).where(eq(resource.fileId, second))).toHaveLength(0)
  })

  it('two replaces of one item with different files leave no orphan', async () => {
    const first = await insertResourceFile(db, fx.lecturer, 'a.pdf')
    const { id } = await createFileItem(fx.lecturer, { courseId: fx.courseA, topicId: fx.topicA, title: 'F', fileId: first })
    const b = await insertResourceFile(db, fx.lecturer, 'b.pdf')
    const c = await insertResourceFile(db, fx.lecturer, 'c.pdf')
    await Promise.all([
      updateFileItem(fx.lecturer, id, { title: 'F', fileId: b }),
      updateFileItem(fx.lecturer, id, { title: 'F', fileId: c }),
    ])
    const [row] = await db.select().from(resource).where(eq(resource.id, id))
    const kept = row.fileId!
    expect([b, c]).toContain(kept)
    // The old file and the file that lost the overwrite are both deleted; only the winner remains.
    const left = (await db.select({ id: file.id }).from(file)).map((f) => f.id)
    expect(left).toContain(kept)
    expect(left).not.toContain(first)
    expect(left).not.toContain(kept === b ? c : b)
  })
})
