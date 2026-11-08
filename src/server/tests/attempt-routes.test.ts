import { eq } from 'drizzle-orm'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import type { Ctx } from '@/server/core/context'
import { AppError } from '@/server/core/errors'
import type { Db } from '@/server/db'
import { courseTest } from '@/server/db/schema'
import { createTestDb } from '@/test/db'
import { at, clearMarkingData, insertStartedTest, setClock, setupCourse } from '@/test/marking-fixture'

let current: Ctx | null = null
vi.mock('@/server/auth/session', () => ({
  getCtx: async () => {
    if (!current) throw new AppError('UNAUTHENTICATED', 'Not signed in')
    return current
  },
}))

import { POST as openPost } from '@/app/api/tests/open/route'
import { POST as syncPost } from '@/app/api/tests/attempts/[attemptId]/sync/route'
import { POST as handInPost } from '@/app/api/tests/attempts/[attemptId]/hand-in/route'

const APP = 'http://clasync.localhost:3000'
const DEVICE = '33333333-3333-4333-8333-333333333333'
const EXIT = '44444444-4444-4444-8444-444444444444'

type Opts = { origin?: string | null; body?: string }

function request(path: string, opts: Opts): Request {
  const headers: Record<string, string> = { host: 'clasync.localhost:3000', 'content-type': 'application/json' }
  const origin = opts.origin === undefined ? APP : opts.origin
  if (origin !== null) headers.origin = origin
  return new Request(`${APP}${path}`, { method: 'POST', headers, body: opts.body })
}

const open = (code: string, opts: Opts = {}) =>
  openPost(request('/api/tests/open', { body: JSON.stringify({ code, deviceId: DEVICE }), ...opts }))
const sync = (attemptId: string, payload: unknown, opts: Opts = {}) =>
  syncPost(request(`/api/tests/attempts/${attemptId}/sync`, { body: JSON.stringify(payload), ...opts }), {
    params: Promise.resolve({ attemptId }),
  })
const handIn = (attemptId: string, payload: unknown, opts: Opts = {}) =>
  handInPost(request(`/api/tests/attempts/${attemptId}/hand-in`, { body: JSON.stringify(payload), ...opts }), {
    params: Promise.resolve({ attemptId }),
  })

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const json = (res: Response) => res.json() as Promise<any>

describe('the runner routes: open, sync and hand-in (fetch with a timeout, not Server Actions)', () => {
  let db: Db

  beforeAll(async () => {
    db = await createTestDb()
  })
  afterEach(async () => {
    current = null
    vi.restoreAllMocks()
    await clearMarkingData(db)
  })

  async function scenario() {
    const c = await setupCourse(db)
    const t = await insertStartedTest(db, c.lecturer, c.bio.id, { mcqOnly: true })
    // The fixture's random code can hold 0 or 1, which a link never does.
    const [test] = await db.update(courseTest).set({ code: 'RT7KQ2' }).where(eq(courseTest.id, t.test.id)).returning()
    setClock(at(2))
    return { ...c, ...t, test }
  }

  it('open, then a lean sync, a sync asking for the paper, and a hand-in, with the same ActionResult JSON', async () => {
    const s = await scenario()
    current = s.alice

    const opened = await open(s.test.code)
    expect(opened.status).toBe(200)
    expect(opened.headers.get('cache-control')).toBe('no-store')
    const openBody = await json(opened)
    expect(openBody).toMatchObject({ ok: true, data: { stage: 'answering', exitsSoFar: 0, acceptedRevs: {} } })
    expect(openBody.data.paper).toHaveLength(1)
    const attemptId: string = openBody.data.attemptId

    const answer = { questionId: s.q1.id, optionId: s.o1.id, text: null, rev: 1 }
    const synced = await json(
      await sync(attemptId, { deviceId: DEVICE, answers: [answer], exits: [{ exitId: EXIT, phase: 'left', awayMs: null }] }),
    )
    expect(synced).toMatchObject({ ok: true, data: { stage: 'answering', exitsSoFar: 1, acceptedRevs: { [s.q1.id]: 1 } } })
    expect(synced.data).not.toHaveProperty('paper')
    expect(synced.data).not.toHaveProperty('saved')
    expect(typeof synced.data.serverNow).toBe('string')

    const full = await json(await sync(attemptId, { deviceId: DEVICE, answers: [], exits: [], withPaper: true }))
    expect(full.data.paper).toHaveLength(1)
    expect(full.data.saved).toEqual([answer])

    const handedIn = await json(
      await handIn(attemptId, { deviceId: DEVICE, answers: [answer], exits: [{ exitId: EXIT, phase: 'back', awayMs: 2000 }] }),
    )
    expect(handedIn).toMatchObject({ ok: true, data: { stage: 'handed_in', acceptedRevs: {} } })
    expect(handedIn.data.result).toMatchObject({ score: 2, outOf: 2 })
  })

  it('errors keep the ActionResult shape with a matching status', async () => {
    const s = await scenario()
    current = s.alice
    const opened = await json(await open(s.test.code))
    if (!opened.ok) throw new Error(JSON.stringify(opened))
    const attemptId: string = opened.data.attemptId

    const bad = await sync(attemptId, { deviceId: 'not-a-uuid', answers: [], exits: [] })
    expect(bad.status).toBe(400)
    expect(await json(bad)).toEqual({ ok: false, code: 'VALIDATION', details: { fields: ['payload'] } })

    const notJson = await syncPost(request(`/api/tests/attempts/${attemptId}/sync`, { body: 'nope' }), {
      params: Promise.resolve({ attemptId }),
    })
    expect(notJson.status).toBe(400)
    expect(await json(notJson)).toEqual({ ok: false, code: 'VALIDATION', details: { fields: ['body'] } })

    const badOpen = await openPost(request('/api/tests/open', { body: JSON.stringify({ code: '', deviceId: DEVICE }) }))
    expect(await json(badOpen)).toEqual({ ok: false, code: 'VALIDATION', details: { fields: ['code'] } })

    current = s.bob
    const other = await sync(attemptId, { deviceId: DEVICE, answers: [], exits: [] })
    expect(other.status).toBe(403)
    expect(await json(other)).toMatchObject({ ok: false, code: 'FORBIDDEN' })
    const notMine = await open('ZZZZZZ')
    expect(notMine.status).toBe(403)
    expect(await json(notMine)).toMatchObject({ ok: false, code: 'FORBIDDEN', details: { reason: 'not_your_course' } })

    current = null
    const out = await handIn(attemptId, { deviceId: DEVICE, answers: [], exits: [] })
    expect(out.status).toBe(401)
    expect(await json(out)).toEqual({ ok: false, code: 'UNAUTHENTICATED' })
  })

  it('another device within a minute is CONFLICT open_elsewhere (409)', async () => {
    const s = await scenario()
    current = s.alice
    const opened = await json(await open(s.test.code))
    if (!opened.ok) throw new Error(JSON.stringify(opened))
    const attemptId: string = opened.data.attemptId
    const res = await sync(attemptId, { deviceId: '55555555-5555-4555-8555-555555555555', answers: [], exits: [] })
    expect(res.status).toBe(409)
    expect(await json(res)).toEqual({ ok: false, code: 'CONFLICT', details: { reason: 'open_elsewhere' } })
  })

  it('refuses another site or no Origin before touching the attempt', async () => {
    const s = await scenario()
    current = s.alice
    const opened = await json(await open(s.test.code))
    if (!opened.ok) throw new Error(JSON.stringify(opened))
    const attemptId: string = opened.data.attemptId
    for (const origin of ['https://evil.example', null]) {
      const answer = { questionId: s.q1.id, optionId: s.o1.id, text: null, rev: 1 }
      for (const res of [
        await open(s.test.code, { origin }),
        await sync(attemptId, { deviceId: DEVICE, answers: [answer], exits: [] }, { origin }),
        await handIn(attemptId, { deviceId: DEVICE, answers: [answer], exits: [] }, { origin }),
      ]) {
        expect(res.status).toBe(403)
        expect(await json(res)).toEqual({ ok: false, code: 'FORBIDDEN' })
      }
    }
    const view = await json(await sync(attemptId, { deviceId: DEVICE, answers: [], exits: [], withPaper: true }))
    expect(view.data).toMatchObject({ stage: 'answering', saved: [] })
  })

  it('a crash is a logged 500 with no detail', async () => {
    const s = await scenario()
    current = s.alice
    const opened = await json(await open(s.test.code))
    if (!opened.ok) throw new Error(JSON.stringify(opened))
    const attemptId: string = opened.data.attemptId
    const attempt = await import('@/server/tests/attempt')
    vi.spyOn(attempt, 'syncAttempt').mockRejectedValue(new Error('db down'))
    const log = vi.spyOn(console, 'error').mockImplementation(() => {})
    const res = await sync(attemptId, { deviceId: DEVICE, answers: [], exits: [] })
    expect(res.status).toBe(500)
    expect(await json(res)).toEqual({ ok: false, code: 'INTERNAL' })
    expect(log).toHaveBeenCalledWith('[tests/sync] unexpected error', 'Error')
  })

  it('each route only answers POST', async () => {
    for (const path of ['open/route', 'attempts/[attemptId]/sync/route', 'attempts/[attemptId]/hand-in/route']) {
      const route = await import(`@/app/api/tests/${path}`)
      expect(Object.keys(route).filter((k) => /^[A-Z]+$/.test(k))).toEqual(['POST'])
      expect(route.dynamic).toBe('force-dynamic')
    }
  })
})
