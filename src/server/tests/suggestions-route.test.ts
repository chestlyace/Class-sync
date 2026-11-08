import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import type { Ctx } from '@/server/core/context'
import { AppError } from '@/server/core/errors'
import type { Db } from '@/server/db'
import { createTestDb } from '@/test/db'
import { answerRow, at, clearMarkingData, insertStartedTest, joinTest, putAnswer, setClock, setupCourse } from '@/test/marking-fixture'
import { fakeSuggester } from './ai/fake'
import { setMarkSuggesterForTests } from './ai/suggester'

let current: Ctx | null = null
vi.mock('@/server/auth/session', () => ({
  getCtx: async () => {
    if (!current) throw new AppError('UNAUTHENTICATED', 'Not signed in')
    return current
  },
}))

import { POST } from '@/app/api/tests/questions/[questionId]/suggestions/route'

const APP = 'http://clasync.localhost:3000'

function post(
  questionId: string,
  opts: { origin?: string | null; body?: string; headers?: Record<string, string> } = {},
): Promise<Response> {
  const headers: Record<string, string> = { host: 'clasync.localhost:3000', ...opts.headers }
  const origin = opts.origin === undefined ? APP : opts.origin
  if (origin !== null) headers.origin = origin
  const request = new Request(`${APP}/api/tests/questions/${encodeURIComponent(questionId)}/suggestions`, {
    method: 'POST',
    headers,
    body: opts.body,
  })
  return POST(request, { params: Promise.resolve({ questionId }) })
}

async function json(res: Response) {
  return res.json() as Promise<unknown>
}

describe('POST /api/tests/questions/[questionId]/suggestions', () => {
  let db: Db

  beforeAll(async () => {
    db = await createTestDb()
  })
  afterEach(async () => {
    current = null
    setMarkSuggesterForTests(undefined)
    vi.restoreAllMocks()
    await clearMarkingData(db)
  })

  /** Alice answers q2 and q3 with real text; Bob leaves q2 blank. */
  async function scenario() {
    const c = await setupCourse(db)
    const t = await insertStartedTest(db, c.lecturer, c.bio.id)
    const a = await joinTest(db, t.test.id, c.alice)
    const b = await joinTest(db, t.test.id, c.bob)
    await putAnswer(db, a.id, t.q2!.id, { text: 'Water crossing a membrane' })
    await putAnswer(db, a.id, t.q3!.id, { text: 'Stores genetic information' })
    await putAnswer(db, b.id, t.q2!.id, { text: ' ' })
    return { ...c, ...t, q2: t.q2!, q3: t.q3!, aliceAt: a, bobAt: b }
  }

  it('stores suggestions only, and reports when suggestions are off', async () => {
    const s = await scenario()
    setClock(at(40))
    current = s.lecturer

    setMarkSuggesterForTests(null)
    let res = await post(s.q2.id)
    expect(res.status).toBe(200)
    expect(res.headers.get('cache-control')).toBe('no-store')
    expect(await json(res)).toEqual({ ok: true, data: { suggested: 0, failed: false } })

    setMarkSuggesterForTests(fakeSuggester)
    res = await post(s.q2.id)
    expect(await json(res)).toEqual({ ok: true, data: { suggested: 1, failed: false } })
    expect(await answerRow(db, s.aliceAt.id, s.q2.id)).toMatchObject({ suggestedMark: 4, mark: null })

    const failing = vi.fn(async () => {
      throw new Error('provider down')
    })
    setMarkSuggesterForTests(failing)
    vi.spyOn(console, 'error').mockImplementation(() => {})
    expect(await json(await post(s.q3.id))).toEqual({ ok: true, data: { suggested: 0, failed: true } })
  })

  it('Try again ({ retry: true }) asks afresh about answers tried with no suggestion', async () => {
    const s = await scenario()
    setClock(at(40))
    current = s.lecturer
    const silent = vi.fn(async () => [])
    setMarkSuggesterForTests(silent)
    expect(await json(await post(s.q2.id))).toEqual({ ok: true, data: { suggested: 0, failed: false } })
    expect(await json(await post(s.q2.id))).toEqual({ ok: true, data: { suggested: 0, failed: false } })
    expect(silent).toHaveBeenCalledTimes(1)

    setMarkSuggesterForTests(fakeSuggester)
    const res = await post(s.q2.id, { body: JSON.stringify({ retry: true }), headers: { 'content-type': 'application/json' } })
    expect(await json(res)).toEqual({ ok: true, data: { suggested: 1, failed: false } })

    for (const body of ['not json', '{"retry":"yes"}', '[]']) {
      const bad = await post(s.q2.id, { body })
      expect(bad.status).toBe(400)
      expect(await json(bad)).toMatchObject({ ok: false, code: 'VALIDATION' })
    }
  })

  it('passes not_final through with when marking opens', async () => {
    const s = await scenario()
    setMarkSuggesterForTests(fakeSuggester)
    setClock(at(31))
    current = s.lecturer
    const res = await post(s.q2.id)
    expect(res.status).toBe(409)
    expect(await json(res)).toEqual({
      ok: false,
      code: 'CONFLICT',
      details: { reason: 'not_final', finalAt: at(32).toISOString() },
    })
  })

  it('a colleague, a student and a signed-out visitor get nothing; junk ids are VALIDATION', async () => {
    const s = await scenario()
    setMarkSuggesterForTests(fakeSuggester)
    setClock(at(40))
    for (const who of [s.colleague, s.alice]) {
      current = who
      const res = await post(s.q2.id)
      expect(res.status).toBe(403)
      expect(await json(res)).toMatchObject({ ok: false, code: 'FORBIDDEN' })
    }
    current = null
    const out = await post(s.q2.id)
    expect(out.status).toBe(401)
    expect(await json(out)).toEqual({ ok: false, code: 'UNAUTHENTICATED' })

    current = s.lecturer
    const junk = await post('x'.repeat(200))
    expect(junk.status).toBe(400)
    expect(await json(junk)).toEqual({ ok: false, code: 'VALIDATION', details: { fields: ['questionId'] } })
    expect(await answerRow(db, s.aliceAt.id, s.q2.id)).toMatchObject({ mark: null, suggestedAt: null })
  })

  it('refuses a request from another site, or with no Origin, before calling the provider', async () => {
    const s = await scenario()
    const suggester = vi.fn(fakeSuggester)
    setMarkSuggesterForTests(suggester)
    setClock(at(40))
    current = s.lecturer
    for (const origin of ['https://evil.example', 'http://clasync.localhost:3001', 'null', 'not a url', null]) {
      const res = await post(s.q2.id, { origin })
      expect(res.status).toBe(403)
      expect(await json(res)).toEqual({ ok: false, code: 'FORBIDDEN' })
    }
    expect(suggester).not.toHaveBeenCalled()
    expect((await answerRow(db, s.aliceAt.id, s.q2.id)).suggestedAt).toBeNull()

    // Behind a proxy, the forwarded host is the app's.
    const proxied = await post(s.q2.id, {
      origin: 'https://clasync.app',
      headers: { host: 'internal:3000', 'x-forwarded-host': 'clasync.app' },
    })
    expect(proxied.status).toBe(200)
    expect(suggester).toHaveBeenCalledTimes(1)
  })

  it('only answers POST', async () => {
    const route = await import('@/app/api/tests/questions/[questionId]/suggestions/route')
    expect(Object.keys(route).filter((k) => /^[A-Z]+$/.test(k))).toEqual(['POST'])
    expect(route.maxDuration).toBe(60)
    expect(route.dynamic).toBe('force-dynamic')
  })
})
