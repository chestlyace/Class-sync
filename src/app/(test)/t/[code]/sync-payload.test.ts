import { describe, expect, it } from 'vitest'
import { MAX_QUESTIONS, SHORT_ANSWER_MAX } from '@/server/tests/rules'
import { MAX_SYNC_EXITS, parseSyncPayload } from './sync-payload'

const DEVICE = '55555555-5555-4555-8555-555555555555'
const EXIT = '66666666-6666-4666-8666-666666666666'

const valid = {
  deviceId: DEVICE,
  answers: [
    { questionId: 'q1', optionId: 'o1', text: null, rev: 1 },
    { questionId: 'q2', optionId: null, text: 'Water moves across a membrane.', rev: 1_000_000 },
  ],
  exits: [
    { exitId: EXIT, phase: 'left', awayMs: null },
    { exitId: EXIT, phase: 'back', awayMs: 86_400_000 },
  ],
}

const answer = (i: number) => ({ questionId: `q${i}`, optionId: 'o1', text: null, rev: 1 })
const exit = (awayMs: number | null) => ({ exitId: EXIT, phase: 'back', awayMs })

describe('parseSyncPayload', () => {
  it('a valid payload parses', () => {
    expect(parseSyncPayload(valid)).toEqual(valid)
    expect(parseSyncPayload({ deviceId: DEVICE, answers: [], exits: [] })).toEqual({
      deviceId: DEVICE,
      answers: [],
      exits: [],
    })
  })

  it('keeps the limits', () => {
    const answers = Array.from({ length: MAX_QUESTIONS }, (_, i) => answer(i))
    expect(parseSyncPayload({ ...valid, answers })).not.toBeNull()
    const exits = Array.from({ length: MAX_SYNC_EXITS }, () => exit(0))
    expect(parseSyncPayload({ ...valid, exits })).not.toBeNull()
    expect(MAX_SYNC_EXITS).toBe(50)
    const text = 'a'.repeat(SHORT_ANSWER_MAX)
    expect(parseSyncPayload({ ...valid, answers: [{ ...answer(1), optionId: null, text }] })).not.toBeNull()
  })

  it.each([
    ['a non-UUID deviceId', { ...valid, deviceId: 'phone-1' }],
    ['a non-UUID exitId', { ...valid, exits: [{ ...exit(0), exitId: 'x' }] }],
    ['rev 0', { ...valid, answers: [{ ...answer(1), rev: 0 }] }],
    ['rev over a million', { ...valid, answers: [{ ...answer(1), rev: 1_000_001 }] }],
    ['a fractional rev', { ...valid, answers: [{ ...answer(1), rev: 1.5 }] }],
    ['101 answers', { ...valid, answers: Array.from({ length: MAX_QUESTIONS + 1 }, (_, i) => answer(i)) }],
    ['the same question twice', { ...valid, answers: [answer(1), { ...answer(1), rev: 2 }] }],
    ['51 exits', { ...valid, exits: Array.from({ length: MAX_SYNC_EXITS + 1 }, () => exit(0)) }],
    ['awayMs -1', { ...valid, exits: [exit(-1)] }],
    ['awayMs over a day', { ...valid, exits: [exit(86_400_001)] }],
    ['a fractional awayMs', { ...valid, exits: [exit(10.5)] }],
    ['an unknown phase', { ...valid, exits: [{ ...exit(0), phase: 'gone' }] }],
    ['text over 1000 chars', { ...valid, answers: [{ ...answer(1), optionId: null, text: 'a'.repeat(SHORT_ANSWER_MAX + 1) }] }],
    ['an empty questionId', { ...valid, answers: [{ ...answer(1), questionId: '' }] }],
    ['a missing field', { deviceId: DEVICE, answers: [] }],
    ['not an object', 'payload'],
    ['null', null],
  ])('%s → null', (_name, value) => {
    expect(parseSyncPayload(value)).toBeNull()
  })

  it('drops unknown keys', () => {
    expect(parseSyncPayload({ ...valid, userId: 'someone-else' })).toEqual(valid)
  })
})
