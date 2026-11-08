import { eq } from 'drizzle-orm'
import { afterEach, beforeAll, describe, expect, it } from 'vitest'
import type { Db } from '@/server/db'
import { courseTopic, resource, resourcePlacement, revisionGroup, revisionQuestion } from '@/server/db/schema'
import { createNote } from '@/server/notes/items'
import { getCourseNotes, getNote } from '@/server/notes/read'
import { createTopic, setTopicHidden } from '@/server/notes/topics'
import { addPracticeQuestions, PRACTICE_BATCH_MAX } from '@/server/revision/authoring'
import { MAX_PRACTICE_PER_TOPIC } from '@/server/revision/rules'
import { getPracticePaper } from '@/server/revision/practice'
import { createTestDb } from '@/test/db'
import { clearMarkingData, setupCourse } from '@/test/marking-fixture'
import { callTool, parseToolInput } from '@/test/mcp'
import { VISIBLE_TOPIC_MESSAGE } from './draft-notes'

const mcq = {
  kind: 'mcq',
  prompt: 'Which organelle makes ATP?',
  options: [
    { text: 'Mitochondrion', correct: true },
    { text: 'Ribosome', correct: false },
  ],
  explanation: 'The powerhouse.',
}
const short = { kind: 'short', prompt: 'Define osmosis.', guide: 'Water across a membrane.' }
const serviceMcq = { kind: 'mcq', prompt: 'P', options: [{ text: 'A', isCorrect: true }, { text: 'B', isCorrect: false }] }

describe('notes and practice draft tools', () => {
  let db: Db

  beforeAll(async () => {
    db = await createTestDb()
  })
  afterEach(async () => {
    // Topics are `restrict` targets: clear what points at them first.
    await db.delete(revisionGroup)
    await db.delete(resourcePlacement)
    await db.delete(resource)
    await db.delete(courseTopic)
    await clearMarkingData(db)
  })

  async function setup() {
    const fx = await setupCourse(db)
    const hidden = (await createTopic(fx.lecturer, fx.bio.id, { title: 'Drafts', hidden: true })).id
    const visible = (await createTopic(fx.lecturer, fx.bio.id, { title: 'Cells' })).id
    return { ...fx, hidden, visible }
  }

  const hiddenOf = async (topicId: string) =>
    (await db.select({ hidden: courseTopic.hidden }).from(courseTopic).where(eq(courseTopic.id, topicId)))[0].hidden

  it('createTopic is visible by default and hidden when asked', async () => {
    const { hidden, visible } = await setup()
    expect(await hiddenOf(hidden)).toBe(true)
    expect(await hiddenOf(visible)).toBe(false)
  })

  it('create_note_draft writes into a hidden topic; students see nothing', async () => {
    const fx = await setup()
    const out = (await callTool('create_note_draft', fx.lecturer, {
      courseId: fx.bio.id,
      topicId: fx.hidden,
      title: 'Osmosis',
      body: '## Definition\n\nWater moves across a **membrane**.',
    })) as { noteId: string; topicCreated: boolean }
    expect(out.topicCreated).toBe(false)
    const note = await getNote(fx.lecturer, fx.bio.id, out.noteId)
    expect(JSON.stringify(note)).toContain('membrane')

    const studentView = await getCourseNotes(fx.alice, fx.bio.id)
    expect(studentView.topics.map((t) => t.id)).toEqual([fx.visible])
    await expect(getNote(fx.alice, fx.bio.id, out.noteId)).rejects.toMatchObject({ code: 'FORBIDDEN' })
  })

  it('create_note_draft with newTopicTitle creates the topic hidden', async () => {
    const fx = await setup()
    const out = (await callTool('create_note_draft', fx.lecturer, {
      courseId: fx.bio.id,
      newTopicTitle: 'Week 3 (draft)',
      title: 'Diffusion',
      body: 'Plain text body.',
    })) as { noteId: string; topicId: string; topicCreated: boolean }
    expect(out.topicCreated).toBe(true)
    expect(await hiddenOf(out.topicId)).toBe(true)
    const lecturerView = await getCourseNotes(fx.lecturer, fx.bio.id)
    const topic = lecturerView.topics.find((t) => t.id === out.topicId)!
    expect(topic).toMatchObject({ title: 'Week 3 (draft)', hidden: true })
    expect(topic.items.map((i) => i.id)).toEqual([out.noteId])
    expect((await getCourseNotes(fx.alice, fx.bio.id)).topics.map((t) => t.id)).not.toContain(out.topicId)
  })

  it('create_note_draft: a visible topic → CONFLICT with the message; another lecturer → FORBIDDEN; nothing left behind', async () => {
    const fx = await setup()
    const args = { courseId: fx.bio.id, topicId: fx.visible, title: 'Osmosis', body: 'Text' }
    await expect(callTool('create_note_draft', fx.lecturer, args)).rejects.toMatchObject({
      code: 'CONFLICT',
      message: VISIBLE_TOPIC_MESSAGE,
    })
    await expect(callTool('create_note_draft', fx.colleague, { ...args, topicId: fx.hidden })).rejects.toMatchObject({
      code: 'FORBIDDEN',
    })
    await expect(
      callTool('create_note_draft', fx.colleague, { courseId: fx.bio.id, newTopicTitle: 'Sneaky', title: 'N', body: 'B' }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' })
    expect(await db.select().from(resource)).toEqual([])
    expect((await db.select().from(courseTopic)).map((t) => t.title).sort()).toEqual(['Cells', 'Drafts'])
    expect(parseToolInput('create_note_draft', { ...args, newTopicTitle: 'Both' }).success).toBe(false)
    expect(parseToolInput('create_note_draft', { courseId: 'c', title: 'N', body: 'B' }).success).toBe(false)
  })

  it('createNote with hiddenTopicOnly refuses a visible topic; without it the app keeps working', async () => {
    const fx = await setup()
    const body = [{ type: 'paragraph', content: [{ type: 'text', text: 'x', styles: {} }] }]
    await expect(
      createNote(fx.lecturer, { courseId: fx.bio.id, topicId: fx.visible, title: 'N', body, hiddenTopicOnly: true }),
    ).rejects.toMatchObject({ code: 'CONFLICT', details: { reason: 'visible_topic' } })
    await expect(createNote(fx.lecturer, { courseId: fx.bio.id, topicId: fx.visible, title: 'N', body })).resolves.toHaveProperty('id')
  })

  it('add_practice_questions adds a batch to a hidden topic; students cannot open it', async () => {
    const fx = await setup()
    const out = (await callTool('add_practice_questions', fx.lecturer, { topicId: fx.hidden, questions: [mcq, short] })) as {
      added: number
      questionIds: string[]
    }
    expect(out.added).toBe(2)
    const rows = await db.select().from(revisionQuestion)
    expect(rows.map((r) => r.kind).sort()).toEqual(['mcq', 'short'])
    await expect(getPracticePaper(fx.alice, fx.bio.id, fx.hidden)).rejects.toMatchObject({ code: 'FORBIDDEN' })
    const preview = await getPracticePaper(fx.lecturer, fx.bio.id, fx.hidden)
    expect(preview.questions.map((q) => q.id)).toEqual(out.questionIds)
  })

  it('add_practice_questions: visible topic → CONFLICT, other lecturer → FORBIDDEN, schema rules', async () => {
    const fx = await setup()
    await expect(callTool('add_practice_questions', fx.lecturer, { topicId: fx.visible, questions: [mcq] })).rejects.toMatchObject({
      code: 'CONFLICT',
      message: VISIBLE_TOPIC_MESSAGE,
    })
    await expect(callTool('add_practice_questions', fx.colleague, { topicId: fx.hidden, questions: [mcq] })).rejects.toMatchObject({
      code: 'FORBIDDEN',
    })
    expect(await db.select().from(revisionQuestion)).toEqual([])
    expect(parseToolInput('add_practice_questions', { topicId: 't', questions: Array(PRACTICE_BATCH_MAX + 1).fill(short) }).success).toBe(false)
    expect(parseToolInput('add_practice_questions', { topicId: 't', questions: [] }).success).toBe(false)
    const noCorrect = { ...mcq, options: mcq.options.map((o) => ({ ...o, correct: false })) }
    expect(parseToolInput('add_practice_questions', { topicId: 't', questions: [noCorrect] }).success).toBe(false)
  })

  it('addPracticeQuestions is all or none and keeps the per-topic limit', async () => {
    const fx = await setup()
    await expect(
      addPracticeQuestions(fx.lecturer, fx.hidden, [serviceMcq, { kind: 'short', prompt: 'P', guide: '' }]),
    ).rejects.toMatchObject({ code: 'VALIDATION', details: { fields: ['guide'], question: 1 } })
    expect(await db.select().from(revisionQuestion)).toEqual([])

    for (let i = 0; i < MAX_PRACTICE_PER_TOPIC / PRACTICE_BATCH_MAX; i++) {
      await addPracticeQuestions(fx.lecturer, fx.hidden, Array(PRACTICE_BATCH_MAX).fill(serviceMcq))
    }
    await expect(addPracticeQuestions(fx.lecturer, fx.hidden, [serviceMcq])).rejects.toMatchObject({
      code: 'CONFLICT',
      details: { reason: 'too_many' },
    })
    const positions = (await db.select({ p: revisionQuestion.position }).from(revisionQuestion)).map((r) => r.p).sort((a, b) => a - b)
    expect(positions).toEqual(Array.from({ length: MAX_PRACTICE_PER_TOPIC }, (_, i) => i))
  })

  it('a topic shown after the drafts were written makes them visible to students as usual', async () => {
    const fx = await setup()
    await callTool('add_practice_questions', fx.lecturer, { topicId: fx.hidden, questions: [short] })
    await setTopicHidden(fx.lecturer, fx.hidden, false)
    const paper = await getPracticePaper(fx.alice, fx.bio.id, fx.hidden)
    expect(paper.questions).toHaveLength(1)
  })
})
