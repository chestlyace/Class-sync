import { beforeAll, describe, expect, it, vi } from 'vitest'
import type { Db } from '@/server/db'
import { sendPush } from '@/server/push/send'
import { createTestDb } from '@/test/db'
import { createNote } from './items'
import { doc, setupNotes } from './test-support'
import { createTopic, deleteTopic, moveTopic, renameTopic, setTopicHidden } from './topics'
import { listCourseTopics } from './read'

vi.mock('@/server/push/send', () => {
  const sendPush = vi.fn(async (items: unknown[]) => ({ sent: 0, skipped: items.length, failed: 0, removed: 0 }))
  return {
    sendPush,
    queuePush: vi.fn(async (_context: string, build: () => Promise<unknown[]>) => {
      await sendPush(await build())
    }),
  }
})

const push = vi.mocked(sendPush)

let db: Db
let fx: Awaited<ReturnType<typeof setupNotes>>

beforeAll(async () => {
  db = await createTestDb()
  fx = await setupNotes(db)
}, 120_000)

const titles = async (courseId: string) => (await listCourseTopics(fx.lecturer, courseId)).map((t) => t.title)

describe('topics', () => {
  it('unhiding an already visible topic pushes nothing; releasing a hidden one pushes', async () => {
    push.mockClear()
    await setTopicHidden(fx.lecturer, fx.topicA, false)
    expect(push).not.toHaveBeenCalled()
    const t = await createTopic(fx.lecturer, fx.courseA, { title: 'Draft', hidden: true })
    await setTopicHidden(fx.lecturer, t.id, false)
    expect(push).toHaveBeenCalledTimes(1)
    await setTopicHidden(fx.lecturer, t.id, false)
    expect(push).toHaveBeenCalledTimes(1)
  })

  it('moves a topic up, does nothing at the ends', async () => {
    const { lecturer } = fx
    const course = fx.courseB
    // courseB already has "Genes"; add two more.
    const t2 = await createTopic(lecturer, course, { title: 'Two' })
    const t3 = await createTopic(lecturer, course, { title: 'Three' })
    expect(await titles(course)).toEqual(['Genes', 'Two', 'Three'])
    await moveTopic(lecturer, t3.id, 'up')
    expect(await titles(course)).toEqual(['Genes', 'Three', 'Two'])
    await moveTopic(lecturer, fx.topicB, 'up')
    expect(await titles(course)).toEqual(['Genes', 'Three', 'Two'])
    await moveTopic(lecturer, t2.id, 'down')
    expect(await titles(course)).toEqual(['Genes', 'Three', 'Two'])
  })

  it('rejects a bad title', async () => {
    await expect(createTopic(fx.lecturer, fx.courseA, { title: '   ' })).rejects.toMatchObject({
      code: 'VALIDATION',
      details: { fields: ['title'] },
    })
    await expect(renameTopic(fx.lecturer, fx.topicA, { title: 'x'.repeat(201) })).rejects.toMatchObject({
      code: 'VALIDATION',
    })
  })

  it('refuses a colleague and a student, and unknown topics', async () => {
    await expect(renameTopic(fx.colleague, fx.topicA, { title: 'Nope' })).rejects.toMatchObject({ code: 'FORBIDDEN' })
    await expect(setTopicHidden(fx.alice, fx.topicA, true)).rejects.toMatchObject({ code: 'FORBIDDEN' })
    await expect(moveTopic(fx.lecturer, 'nope', 'up')).rejects.toMatchObject({ code: 'FORBIDDEN' })
    await expect(createTopic(fx.colleague, fx.courseA, { title: 'Nope' })).rejects.toMatchObject({ code: 'FORBIDDEN' })
  })

  it('renames, hides and deletes an empty topic; a topic with an item is not empty', async () => {
    const t = await createTopic(fx.lecturer, fx.courseA, { title: 'Temp' })
    await renameTopic(fx.lecturer, t.id, { title: 'Temporary' })
    await setTopicHidden(fx.lecturer, t.id, true)
    expect(await titles(fx.courseA)).toContain('Temporary')
    await createNote(fx.lecturer, { courseId: fx.courseA, topicId: t.id, title: 'N', body: doc('x') })
    await expect(deleteTopic(fx.lecturer, t.id)).rejects.toMatchObject({
      code: 'CONFLICT',
      details: { reason: 'not_empty' },
    })
    const empty = await createTopic(fx.lecturer, fx.courseA, { title: 'Empty' })
    await deleteTopic(fx.lecturer, empty.id)
    expect(await titles(fx.courseA)).not.toContain('Empty')
  })
})
