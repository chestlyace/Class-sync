import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Ctx } from '@/server/core/context'
import { AppError } from '@/server/core/errors'
import { createFileItem, createLink, createNote } from '@/server/notes/items'
import { doc, insertResourceFile, setupNotes } from '@/server/notes/test-support'
import { setTopicHidden } from '@/server/notes/topics'
import { createTestDb } from '@/test/db'

vi.mock('@/server/push/send', () => ({
  sendPush: vi.fn(async () => ({ sent: 0, skipped: 0, failed: 0, removed: 0 })),
  queuePush: vi.fn(async () => {}),
}))

let current: Ctx | null = null
vi.mock('@/server/auth/session', () => ({
  getCtx: async () => {
    if (!current) throw new AppError('UNAUTHENTICATED', 'Not signed in')
    return current
  },
}))

import { GET } from './route'

const APP = 'http://clasync.localhost:3000'

let db: Awaited<ReturnType<typeof createTestDb>>
let fx: Awaited<ReturnType<typeof setupNotes>>

beforeEach(async () => {
  db = await createTestDb()
  fx = await setupNotes(db)
}, 120_000)
afterEach(() => {
  current = null
})

const open = (courseId: string, resourceId: string) =>
  GET(new Request(`${APP}/courses/${courseId}/notes/${resourceId}/open`), {
    params: Promise.resolve({ courseId, resourceId }),
  })

describe('GET /courses/[courseId]/notes/[resourceId]/open', () => {
  it('redirects a link to its URL', async () => {
    const l = await createLink(fx.lecturer, { courseId: fx.courseA, topicId: fx.topicA, title: 'Site', url: 'https://www.example.org/a' })
    current = fx.alice
    const res = await open(fx.courseA, l.id)
    expect(res.status).toBe(302)
    expect(res.headers.get('location')).toBe('https://www.example.org/a')
    expect(res.headers.get('cache-control')).toBe('no-store')
  })

  it('redirects a file to /api/files/<id>', async () => {
    const fileId = await insertResourceFile(db, fx.lecturer)
    const f = await createFileItem(fx.lecturer, { courseId: fx.courseA, topicId: fx.topicA, title: 'Slides', fileId })
    current = fx.alice
    const res = await open(fx.courseA, f.id)
    expect(res.status).toBe(302)
    expect(new URL(res.headers.get('location')!, APP).pathname).toBe(`/api/files/${fileId}`)
  })

  it('answers 403 for a note, a hidden topic and an unknown item, saying nothing more', async () => {
    const n = await createNote(fx.lecturer, { courseId: fx.courseA, topicId: fx.topicA, title: 'N', body: doc('x') })
    current = fx.alice
    expect((await open(fx.courseA, n.id)).status).toBe(403)
    const l = await createLink(fx.lecturer, { courseId: fx.courseA, topicId: fx.topicA, title: 'Site', url: 'https://example.org/' })
    await setTopicHidden(fx.lecturer, fx.topicA, true)
    const res = await open(fx.courseA, l.id)
    expect(res.status).toBe(403)
    expect(res.headers.get('location')).toBeNull()
    expect(await res.json()).toEqual({ error: 'FORBIDDEN' })
    expect((await open(fx.courseA, crypto.randomUUID())).status).toBe(403)
  })

  it('answers 401 when signed out', async () => {
    expect((await open(fx.courseA, crypto.randomUUID())).status).toBe(401)
  })
})
