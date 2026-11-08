import { beforeEach, describe, expect, it } from 'vitest'
import type { Db } from '@/server/db'
import { courseTest, revisionGroup, revisionQuestion } from '@/server/db/schema'
import { createTestDb } from '@/test/db'
import { ctxFor, makeUser } from '@/test/factories'
import { createFileItem, createLink, createNote, updateNote } from './items'
import { getCourseNotes, getItemForEdit, getNote, listCourseTopics, openItem } from './read'
import { doc, insertResourceFile, setupNotes } from './test-support'
import { createTopic, moveTopic, setTopicHidden } from './topics'

let db: Db
let fx: Awaited<ReturnType<typeof setupNotes>>

beforeEach(async () => {
  db = await createTestDb()
  fx = await setupNotes(db)
}, 120_000)

const note = (title: string, text: string, topicId = fx.topicA) =>
  createNote(fx.lecturer, { courseId: fx.courseA, topicId, title, body: doc(text) })

describe('student reads', () => {
  it('shows visible topics only, in order', async () => {
    const t2 = await createTopic(fx.lecturer, fx.courseA, { title: 'Second' })
    const t3 = await createTopic(fx.lecturer, fx.courseA, { title: 'Third' })
    await setTopicHidden(fx.lecturer, t2.id, true)
    await moveTopic(fx.lecturer, t3.id, 'up')
    const student = await getCourseNotes(fx.alice, fx.courseA)
    expect(student.role).toBe('student')
    expect(student.topics.map((t) => t.title)).toEqual(['Cells', 'Third'])
    expect(student.otherCourses).toEqual([])
    const lecturer = await getCourseNotes(fx.lecturer, fx.courseA)
    expect(lecturer.role).toBe('lecturer')
    expect(lecturer.topics.map((t) => t.title)).toEqual(['Cells', 'Third', 'Second'])
    expect(lecturer.topics[2].hidden).toBe(true)
    expect(lecturer.otherCourses).toEqual([
      { id: fx.courseB, label: 'Genetics · University of Buea · Biology L1' },
    ])
  })

  it('isNew until opened, and stays read after an update', async () => {
    const n = await note('Notes', 'hello')
    const l = await createLink(fx.lecturer, { courseId: fx.courseA, topicId: fx.topicA, title: 'Site', url: 'https://www.example.org/a' })
    const isNew = async (id: string) =>
      (await getCourseNotes(fx.alice, fx.courseA)).topics[0].items.find((i) => i.id === id)!.isNew
    expect(await isNew(n.id)).toBe(true)
    expect(await isNew(l.id)).toBe(true)
    const listed = (await getCourseNotes(fx.alice, fx.courseA)).topics[0].items.find((i) => i.id === l.id)!
    expect(listed.host).toBe('example.org')
    await getNote(fx.alice, fx.courseA, n.id)
    expect(await openItem(fx.alice, fx.courseA, l.id)).toEqual({ kind: 'link', url: 'https://www.example.org/a' })
    expect(await isNew(n.id)).toBe(false)
    expect(await isNew(l.id)).toBe(false)
    await updateNote(fx.lecturer, n.id, { title: 'Notes v2', body: doc('changed') })
    expect(await isNew(n.id)).toBe(false)
    // The lecturer never sees NEW and viewing doesn't record anything for them.
    expect((await getCourseNotes(fx.lecturer, fx.courseA)).topics[0].items.every((i) => !i.isNew)).toBe(true)
    // Bob has not opened anything.
    expect((await getCourseNotes(fx.bob, fx.courseA)).topics[0].items.every((i) => i.isNew)).toBe(true)
  })

  it('opens a file item as a file', async () => {
    const fileId = await insertResourceFile(db, fx.lecturer)
    const { id } = await createFileItem(fx.lecturer, { courseId: fx.courseA, topicId: fx.topicA, title: 'F', fileId })
    expect(await openItem(fx.alice, fx.courseA, id)).toEqual({ kind: 'file', fileId })
    const item = (await getCourseNotes(fx.alice, fx.courseA)).topics[0].items[0]
    expect(item.file).toMatchObject({ id: fileId, name: 'slides.pdf' })
    await expect(getNote(fx.alice, fx.courseA, id)).rejects.toMatchObject({ code: 'FORBIDDEN' })
  })

  it('forbids a hidden topic’s items and an unrostered student, leaking nothing', async () => {
    const n = await note('Secret title', 'x')
    const l = await createLink(fx.lecturer, { courseId: fx.courseA, topicId: fx.topicA, title: 'L', url: 'https://x.org' })
    await setTopicHidden(fx.lecturer, fx.topicA, true)
    await expect(getNote(fx.alice, fx.courseA, n.id)).rejects.toMatchObject({ code: 'FORBIDDEN' })
    await expect(openItem(fx.alice, fx.courseA, l.id)).rejects.toMatchObject({ code: 'FORBIDDEN' })
    await expect(getItemForEdit(fx.alice, fx.courseA, n.id)).rejects.toMatchObject({ code: 'FORBIDDEN' })
    await expect(listCourseTopics(fx.alice, fx.courseA)).rejects.toMatchObject({ code: 'FORBIDDEN' })
    const listing = await getCourseNotes(fx.alice, fx.courseA, { q: 'Secret' })
    expect(JSON.stringify(listing)).not.toContain('Secret title')
    await setTopicHidden(fx.lecturer, fx.topicA, false)
    // A student not on the course, and a colleague lecturer.
    await expect(getCourseNotes(fx.colleague, fx.courseA)).rejects.toMatchObject({ code: 'FORBIDDEN' })
    await expect(getNote(fx.colleague, fx.courseA, n.id)).rejects.toMatchObject({ code: 'FORBIDDEN' })
    // A note of another course asked for through this one.
    const other = await createNote(fx.lecturer, { courseId: fx.courseB, topicId: fx.topicB, title: 'B only', body: doc('b') })
    await expect(getNote(fx.alice, fx.courseA, other.id)).rejects.toMatchObject({ code: 'FORBIDDEN' })
  })
})

describe('students off the roster', () => {
  it('are refused everywhere, even for a visible note', async () => {
    const n = await note('Visible', 'x')
    const l = await createLink(fx.lecturer, { courseId: fx.courseA, topicId: fx.topicA, title: 'L', url: 'https://x.org' })
    const stranger = ctxFor(db, await makeUser(db, { role: 'student', name: 'Stranger' }))
    await expect(getCourseNotes(stranger, fx.courseA)).rejects.toMatchObject({ code: 'FORBIDDEN' })
    await expect(getCourseNotes(stranger, fx.courseA, { q: 'Visible' })).rejects.toMatchObject({ code: 'FORBIDDEN' })
    await expect(getNote(stranger, fx.courseA, n.id)).rejects.toMatchObject({ code: 'FORBIDDEN' })
    await expect(openItem(stranger, fx.courseA, l.id)).rejects.toMatchObject({ code: 'FORBIDDEN' })
    // The same student reads fine once on the roster (Alice is), proving the note itself is visible.
    expect((await getNote(fx.alice, fx.courseA, n.id)).title).toBe('Visible')
  })
})

describe('search', () => {
  it('matches title and body text case-insensitively and drops empty topics', async () => {
    await note('Intro', 'Database Normalisation rules')
    await note('Other', 'nothing relevant')
    const other = await createTopic(fx.lecturer, fx.courseA, { title: 'Empty topic' })
    await note('Titled normal form', 'zzz', other.id)
    const found = await getCourseNotes(fx.alice, fx.courseA, { q: 'normal' })
    expect(found.topics.map((t) => [t.title, t.items.map((i) => i.title)])).toEqual([
      ['Cells', ['Intro']],
      ['Empty topic', ['Titled normal form']],
    ])
    const none = await getCourseNotes(fx.alice, fx.courseA, { q: 'quantum' })
    expect(none.topics).toEqual([])
  })

  it('treats % and _ literally and rejects a long query', async () => {
    await note('Plain', 'a note with 50% off and under_score')
    await note('Other', 'no wildcard characters here')
    const pct = await getCourseNotes(fx.alice, fx.courseA, { q: '%' })
    expect(pct.topics[0].items.map((i) => i.title)).toEqual(['Plain'])
    const under = await getCourseNotes(fx.alice, fx.courseA, { q: 'x_y' })
    expect(under.topics).toEqual([])
    expect((await getCourseNotes(fx.alice, fx.courseA, { q: 'r\\' })).topics).toEqual([])
    await expect(getCourseNotes(fx.alice, fx.courseA, { q: 'x'.repeat(101) })).rejects.toMatchObject({
      code: 'VALIDATION',
    })
    expect((await getCourseNotes(fx.alice, fx.courseA, { q: '   ' })).topics).toHaveLength(1)
  })
})

describe('practice counts', () => {
  it('students count only non-held questions; lecturers see held', async () => {
    const [free] = await db
      .insert(revisionGroup)
      .values({ courseId: fx.courseA, topicId: fx.topicA, position: 1 })
      .returning({ id: revisionGroup.id })
    // A family with a test that has not started is held.
    const [t] = await db
      .insert(courseTest)
      .values({
        courseId: fx.courseA,
        code: 'ABC123',
        title: 'CA 1',
        durationMinutes: 30,
        defaultMark: 2,
        shuffle: true,
        maxExits: 3,
        maxAbsenceSeconds: 10,
        weight: 1,
        familyId: 'fam-1',
        createdBy: fx.lecturer.user.id,
      })
      .returning({ id: courseTest.id })
    expect(t.id).toBeDefined()
    const [held] = await db
      .insert(revisionGroup)
      .values({ courseId: fx.courseA, topicId: fx.topicA, sourceFamilyId: 'fam-1', sourceTitle: 'CA 1', position: 2 })
      .returning({ id: revisionGroup.id })
    const q = (groupId: string, position: number) => ({ groupId, position, kind: 'short' as const, prompt: 'P', guide: 'G' })
    await db.insert(revisionQuestion).values([q(free.id, 1), q(free.id, 2), q(held.id, 1), q(held.id, 2), q(held.id, 3)])
    const student = await getCourseNotes(fx.alice, fx.courseA)
    expect(student.topics[0].practice).toEqual({ count: 2, held: false })
    const lecturer = await getCourseNotes(fx.lecturer, fx.courseA)
    expect(lecturer.topics[0].practice).toEqual({ count: 5, held: true })
    const n = await note('N', 'x')
    expect((await getNote(fx.alice, fx.courseA, n.id)).practiceCount).toBe(2)
    expect((await getNote(fx.lecturer, fx.courseA, n.id)).practiceCount).toBe(5)
  })

  it('is null when the viewer may see no questions', async () => {
    const [held] = await db
      .insert(revisionGroup)
      .values({ courseId: fx.courseA, topicId: fx.topicA, sourceFamilyId: 'fam-2', position: 1 })
      .returning({ id: revisionGroup.id })
    await db.insert(courseTest).values({
      courseId: fx.courseA,
      code: 'XYZ789',
      title: 'CA 2',
      durationMinutes: 30,
      defaultMark: 2,
      shuffle: true,
      maxExits: 3,
      maxAbsenceSeconds: 10,
      weight: 1,
      familyId: 'fam-2',
      createdBy: fx.lecturer.user.id,
    })
    await db.insert(revisionQuestion).values({ groupId: held.id, position: 1, kind: 'short', prompt: 'P', guide: 'G' })
    expect((await getCourseNotes(fx.alice, fx.courseA)).topics[0].practice).toBeNull()
    expect((await getCourseNotes(fx.lecturer, fx.courseA)).topics[0].practice).toEqual({ count: 1, held: true })
  })
})
