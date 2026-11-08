import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import type { Ctx } from '@/server/core/context'
import { AppError } from '@/server/core/errors'
import type { Db } from '@/server/db'
import { setAfterResponseForTests } from '@/server/lib/after-response'
import { createTestDb } from '@/test/db'
import {
  answerRow,
  at,
  clearMarkingData,
  insertStartedTest,
  joinTest,
  putAnswer,
  setClock,
  setupCourse,
  testRowOf,
} from '@/test/marking-fixture'
import { fakeSuggester } from './ai/fake'
import { setMarkSuggesterForTests } from './ai/suggester'

let current: Ctx | null = null
vi.mock('@/server/auth/session', () => ({
  getCtx: async () => {
    if (!current) throw new AppError('UNAUTHENTICATED', 'Not signed in')
    return current
  },
}))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))

import { confirmMarkAction, releaseResultsAction, suggestMarksAction } from '@/app/(app)/courses/test-marking-actions'

describe('test marking actions', () => {
  let db: Db

  beforeAll(async () => {
    db = await createTestDb()
  })
  afterEach(async () => {
    current = null
    setMarkSuggesterForTests(undefined)
    setAfterResponseForTests(null)
    await clearMarkingData(db)
  })

  /** Alice answers q2 and q3 with real text; Bob leaves q2 blank; Dave never joins. */
  async function scenario() {
    const c = await setupCourse(db)
    const t = await insertStartedTest(db, c.lecturer, c.bio.id)
    const a = await joinTest(db, t.test.id, c.alice)
    const b = await joinTest(db, t.test.id, c.bob)
    await putAnswer(db, a.id, t.q2!.id, { text: 'Water crossing a membrane' })
    await putAnswer(db, a.id, t.q3!.id, { text: 'Stores genetic information' })
    await putAnswer(db, b.id, t.q2!.id, { text: ' ' })
    setAfterResponseForTests(() => {}) // release emails are not under test here
    return { ...c, ...t, q2: t.q2!, q3: t.q3!, aliceAt: a, bobAt: b }
  }

  it('confirmMarkAction reads "3,5" and "3.5" alike and stores a blank comment as none', async () => {
    const s = await scenario()
    setClock(at(40))
    current = s.lecturer

    expect(await confirmMarkAction(s.aliceAt.id, s.q2.id, '3,5', '  ')).toEqual({ ok: true, data: null })
    expect(await answerRow(db, s.aliceAt.id, s.q2.id)).toMatchObject({ mark: 3.5, comment: null })

    expect(await confirmMarkAction(s.aliceAt.id, s.q2.id, ' 2.25 ', 'Name the membrane.')).toEqual({ ok: true, data: null })
    expect(await answerRow(db, s.aliceAt.id, s.q2.id)).toMatchObject({ mark: 2.25, comment: 'Name the membrane.' })
  })

  it('confirmMarkAction refuses a mark that is blank, junk, negative, off-step or above the maximum', async () => {
    const s = await scenario()
    setClock(at(40))
    current = s.lecturer
    for (const mark of ['', 'abc', '-1', '4.1', '5', '1e1', '2,5,0']) {
      expect(await confirmMarkAction(s.aliceAt.id, s.q2.id, mark, '')).toEqual({
        ok: false,
        code: 'VALIDATION',
        details: { fields: ['mark'] },
      })
    }
    expect(await confirmMarkAction(s.aliceAt.id, s.q2.id, '2', 'x'.repeat(1001))).toMatchObject({
      ok: false,
      code: 'VALIDATION',
      details: { fields: ['comment'] },
    })
    // A blank answer scores 0 by itself: nothing to confirm.
    expect(await confirmMarkAction(s.bobAt.id, s.q2.id, '0', '')).toMatchObject({
      ok: false,
      code: 'VALIDATION',
      details: { fields: ['answer'] },
    })
    expect((await answerRow(db, s.aliceAt.id, s.q2.id)).mark).toBeNull()
  })

  it('every action passes not_final through with when marking opens', async () => {
    const s = await scenario()
    setMarkSuggesterForTests(fakeSuggester)
    setClock(at(31))
    current = s.lecturer
    const notFinal = { ok: false, code: 'CONFLICT', details: { reason: 'not_final', finalAt: at(32).toISOString() } }
    expect(await suggestMarksAction(s.q2.id)).toEqual(notFinal)
    expect(await confirmMarkAction(s.aliceAt.id, s.q2.id, '3', '')).toEqual(notFinal)
    expect(await releaseResultsAction(s.test.id)).toEqual(notFinal)
  })

  it('suggestMarksAction stores suggestions only, and reports when suggestions are off', async () => {
    const s = await scenario()
    setClock(at(40))
    current = s.lecturer

    setMarkSuggesterForTests(null)
    expect(await suggestMarksAction(s.q2.id)).toEqual({ ok: true, data: { suggested: 0, failed: false } })

    setMarkSuggesterForTests(fakeSuggester)
    expect(await suggestMarksAction(s.q2.id)).toEqual({ ok: true, data: { suggested: 1, failed: false } })
    expect(await answerRow(db, s.aliceAt.id, s.q2.id)).toMatchObject({ suggestedMark: 4, mark: null })

    const failing = vi.fn(async () => {
      throw new Error('provider down')
    })
    setMarkSuggesterForTests(failing)
    vi.spyOn(console, 'error').mockImplementation(() => {})
    expect(await suggestMarksAction(s.q3.id)).toEqual({ ok: true, data: { suggested: 0, failed: true } })
    vi.restoreAllMocks()
  })

  it('releaseResultsAction is CONFLICT unmarked with the count, then releases once everything is confirmed', async () => {
    const s = await scenario()
    setClock(at(40))
    current = s.lecturer
    expect(await releaseResultsAction(s.test.id)).toEqual({
      ok: false,
      code: 'CONFLICT',
      details: { reason: 'unmarked', count: 2 },
    })
    await confirmMarkAction(s.aliceAt.id, s.q2.id, '4', '')
    await confirmMarkAction(s.aliceAt.id, s.q3.id, '1,5', '')
    expect(await releaseResultsAction(s.test.id)).toEqual({ ok: true, data: { released: 2 } })
    expect((await testRowOf(db, s.test.id)).resultsReleasedAt).toEqual(at(40))
  })

  it('a colleague, a student and a signed-out visitor get nothing', async () => {
    const s = await scenario()
    setMarkSuggesterForTests(fakeSuggester)
    setClock(at(40))
    for (const who of [s.colleague, s.alice]) {
      current = who
      expect(await suggestMarksAction(s.q2.id)).toMatchObject({ ok: false, code: 'FORBIDDEN' })
      expect(await confirmMarkAction(s.aliceAt.id, s.q2.id, '4', '')).toMatchObject({ ok: false, code: 'FORBIDDEN' })
      expect(await releaseResultsAction(s.test.id)).toMatchObject({ ok: false, code: 'FORBIDDEN' })
    }
    current = null
    expect(await confirmMarkAction(s.aliceAt.id, s.q2.id, '4', '')).toMatchObject({ ok: false, code: 'UNAUTHENTICATED' })
    // Junk ids never reach the database as anything but a refusal.
    current = s.lecturer
    expect(await confirmMarkAction('', s.q2.id, '4', '')).toMatchObject({ ok: false, code: 'VALIDATION' })
    expect(await suggestMarksAction('x'.repeat(200))).toMatchObject({ ok: false, code: 'VALIDATION' })
    const row = await answerRow(db, s.aliceAt.id, s.q2.id)
    expect(row).toMatchObject({ mark: null, suggestedAt: null })
  })
})
