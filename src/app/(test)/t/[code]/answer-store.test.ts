import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { MAX_QUESTIONS, SHORT_ANSWER_MAX } from '@/server/tests/rules'
import {
  acknowledge,
  answeredCount,
  attemptKey,
  emptyAttempt,
  loadLocalAttempt,
  mergeServerCopy,
  pendingAnswers,
  pendingExits,
  recordAnswer,
  recordLeaveEvent,
  saveLocalAttempt,
  type LocalAttempt,
} from './answer-store'
import { MAX_SYNC_EXITS, parseSyncPayload } from './sync-payload'

function memoryStorage(): Storage {
  const map = new Map<string, string>()
  return {
    get length() {
      return map.size
    },
    clear: () => map.clear(),
    getItem: (k) => (map.has(k) ? map.get(k)! : null),
    key: (i) => [...map.keys()][i] ?? null,
    removeItem: (k) => void map.delete(k),
    setItem: (k, v) => void map.set(k, String(v)),
  }
}

let storage: Storage
beforeEach(() => {
  storage = memoryStorage()
  vi.stubGlobal('localStorage', storage)
})
afterEach(() => {
  vi.unstubAllGlobals()
})

const EXIT_A = '11111111-1111-4111-8111-111111111111'
const EXIT_B = '22222222-2222-4222-8222-222222222222'
const pick = (optionId: string) => ({ optionId, text: null })
const write = (text: string) => ({ optionId: null, text })

describe('attemptKey', () => {
  it('names the user and the attempt', () => {
    expect(attemptKey('u1', 'a1')).toBe('clasync:test:u1:a1')
  })
})

describe('answers', () => {
  it('recordAnswer bumps rev; pendingAnswers returns only unsent revs; acknowledge clears them', () => {
    let s = recordAnswer(emptyAttempt(), 'q1', pick('o1'))
    s = recordAnswer(s, 'q2', write('photosynthesis'))
    s = recordAnswer(s, 'q1', pick('o2'))
    expect(s.answers.q1).toEqual({ optionId: 'o2', text: null, rev: 2, sentRev: 0 })
    expect(pendingAnswers(s)).toEqual([
      { questionId: 'q1', optionId: 'o2', text: null, rev: 2 },
      { questionId: 'q2', optionId: null, text: 'photosynthesis', rev: 1 },
    ])
    s = acknowledge(s, { q1: 2, q2: 1 }, [])
    expect(pendingAnswers(s)).toEqual([])
    expect(s.answers.q1).toEqual({ optionId: 'o2', text: null, rev: 2, sentRev: 2 })
  })

  it('does not mutate the state it is given', () => {
    const before = emptyAttempt()
    recordAnswer(before, 'q1', pick('o1'))
    expect(before).toEqual(emptyAttempt())
  })

  it('an answer changed while its sync was in flight stays pending after the old rev is acknowledged', () => {
    let s = recordAnswer(emptyAttempt(), 'q1', pick('o1'))
    const sent = pendingAnswers(s)
    s = recordAnswer(s, 'q1', pick('o3')) // changed while the request was out
    s = acknowledge(s, { q1: sent[0].rev }, [])
    expect(pendingAnswers(s)).toEqual([{ questionId: 'q1', optionId: 'o3', text: null, rev: 2 }])
  })

  it('a late, older acknowledgement never lowers sentRev', () => {
    let s = recordAnswer(recordAnswer(emptyAttempt(), 'q1', pick('o1')), 'q1', pick('o2'))
    s = acknowledge(s, { q1: 2 }, [])
    s = acknowledge(s, { q1: 1 }, [])
    expect(s.answers.q1.sentRev).toBe(2)
    expect(pendingAnswers(s)).toEqual([])
  })

  it('acknowledging a question we have no answer for is ignored', () => {
    const s = acknowledge(emptyAttempt(), { q9: 3 }, [])
    expect(s.answers).toEqual({})
  })

  it('text longer than the limit is cut so the sync stays valid', () => {
    const s = recordAnswer(emptyAttempt(), 'q1', write('a'.repeat(SHORT_ANSWER_MAX + 50)))
    expect(s.answers.q1.text).toHaveLength(SHORT_ANSWER_MAX)
  })

  it('cutting text never leaves half of an emoji', () => {
    const s = recordAnswer(emptyAttempt(), 'q1', write('a'.repeat(SHORT_ANSWER_MAX - 1) + '😀'))
    expect(s.answers.q1.text).toBe('a'.repeat(SHORT_ANSWER_MAX - 1))
  })

  it('answeredCount ignores blank text', () => {
    let s = recordAnswer(emptyAttempt(), 'q1', pick('o1'))
    s = recordAnswer(s, 'q2', write('  \n '))
    s = recordAnswer(s, 'q3', write('mitochondria'))
    s = recordAnswer(s, 'q4', { optionId: null, text: null }) // cleared
    expect(answeredCount(s)).toBe(2)
  })
})

describe('leave reports', () => {
  it('a left event opens the exit and queues a left report; back closes it and queues back', () => {
    let s = recordLeaveEvent(emptyAttempt(), { type: 'left', exitId: EXIT_A, leftAtEpochMs: 1000 })
    expect(s.openExit).toEqual({ exitId: EXIT_A, leftAtEpochMs: 1000 })
    expect(s.exits).toEqual([{ exitId: EXIT_A, phase: 'left', awayMs: null }])
    s = recordLeaveEvent(s, { type: 'back', exitId: EXIT_A, awayMs: 4000 })
    expect(s.openExit).toBeNull()
    expect(pendingExits(s)).toEqual([
      { exitId: EXIT_A, phase: 'left', awayMs: null },
      { exitId: EXIT_A, phase: 'back', awayMs: 4000 },
    ])
  })

  it('acknowledging a sent left report keeps the back report queued meanwhile', () => {
    let s = recordLeaveEvent(emptyAttempt(), { type: 'left', exitId: EXIT_A, leftAtEpochMs: 0 })
    const sent = pendingExits(s)
    s = recordLeaveEvent(s, { type: 'back', exitId: EXIT_A, awayMs: 2000 })
    s = acknowledge(
      s,
      {},
      sent.map((e) => e.exitId),
    )
    expect(s.exits).toEqual([{ exitId: EXIT_A, phase: 'back', awayMs: 2000 }])
  })

  it('acknowledging both reports of an exit removes both', () => {
    let s = recordLeaveEvent(emptyAttempt(), { type: 'left', exitId: EXIT_A, leftAtEpochMs: 0 })
    s = recordLeaveEvent(s, { type: 'back', exitId: EXIT_A, awayMs: 2000 })
    s = recordLeaveEvent(s, { type: 'left', exitId: EXIT_B, leftAtEpochMs: 3000 })
    s = acknowledge(s, {}, [EXIT_A, EXIT_A])
    expect(s.exits).toEqual([{ exitId: EXIT_B, phase: 'left', awayMs: null }])
  })

  it('pendingExits sends at most the payload limit, oldest first', () => {
    let s = emptyAttempt()
    for (let i = 0; i < MAX_SYNC_EXITS + 5; i++) {
      const id = `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`
      s = recordLeaveEvent(s, { type: 'left', exitId: id, leftAtEpochMs: i })
    }
    expect(pendingExits(s)).toHaveLength(MAX_SYNC_EXITS)
    expect(pendingExits(s)[0].exitId).toBe('00000000-0000-4000-8000-000000000000')
  })
})

describe('storage', () => {
  it('state survives a reload (save then load) and junk in storage reads as empty', () => {
    const key = attemptKey('u1', 'a1')
    let s = recordAnswer(emptyAttempt(), 'q1', pick('o1'))
    s = recordAnswer(s, 'q2', write('osmosis'))
    s = acknowledge(s, { q1: 1 }, [])
    s = recordLeaveEvent(s, { type: 'left', exitId: EXIT_A, leftAtEpochMs: 123 })
    saveLocalAttempt(key, s)
    expect(loadLocalAttempt(key)).toEqual(s)

    for (const junk of ['{not json', '42', '"text"', 'null', '[]', '{"answers":7}']) {
      storage.setItem(key, junk)
      expect(loadLocalAttempt(key)).toEqual(emptyAttempt())
    }
    expect(loadLocalAttempt(attemptKey('u1', 'missing'))).toEqual(emptyAttempt())
  })

  it('a damaged answer or report is dropped, the rest is kept', () => {
    const key = attemptKey('u1', 'a1')
    storage.setItem(
      key,
      JSON.stringify({
        answers: {
          q1: { optionId: 'o1', text: null, rev: 1, sentRev: 0 },
          q2: { optionId: 5, text: null, rev: 1, sentRev: 0 },
          q3: { optionId: null, text: 'x', rev: 0, sentRev: 0 },
          q4: { optionId: null, text: 'y', rev: 2, sentRev: 7 },
        },
        exits: [{ exitId: EXIT_A, phase: 'left', awayMs: null }, { exitId: 'nope', phase: 'left', awayMs: null }],
        openExit: { exitId: EXIT_A, leftAtEpochMs: 'yesterday' },
      }),
    )
    expect(loadLocalAttempt(key)).toEqual({
      answers: { q1: { optionId: 'o1', text: null, rev: 1, sentRev: 0 } },
      exits: [{ exitId: EXIT_A, phase: 'left', awayMs: null }],
      openExit: null,
    })
  })

  it('works without storage and when storage throws', () => {
    vi.stubGlobal('localStorage', undefined)
    saveLocalAttempt('k', recordAnswer(emptyAttempt(), 'q1', pick('o1')))
    expect(loadLocalAttempt('k')).toEqual(emptyAttempt())
    const fail = () => {
      throw new DOMException('QuotaExceededError', 'QuotaExceededError')
    }
    vi.stubGlobal('localStorage', { length: 0, clear: fail, getItem: fail, key: fail, removeItem: fail, setItem: fail })
    expect(() => saveLocalAttempt('k', emptyAttempt())).not.toThrow()
    expect(loadLocalAttempt('k')).toEqual(emptyAttempt())
  })

  it('whatever the store holds builds a payload the server schema accepts', () => {
    let s = emptyAttempt()
    for (let i = 0; i < MAX_QUESTIONS; i++) s = recordAnswer(s, `q${i}`, write('z'.repeat(SHORT_ANSWER_MAX * 2)))
    s = recordLeaveEvent(s, { type: 'left', exitId: EXIT_A, leftAtEpochMs: 0 })
    s = recordLeaveEvent(s, { type: 'back', exitId: EXIT_A, awayMs: 86_400_000 })
    const payload = {
      deviceId: '33333333-3333-4333-8333-333333333333',
      answers: pendingAnswers(s),
      exits: pendingExits(s),
    }
    expect(parseSyncPayload(payload)).toEqual(payload)
  })
})

describe('mergeServerCopy', () => {
  it('mergeServerCopy keeps a newer local answer and fills questions only the server has', () => {
    let s: LocalAttempt = recordAnswer(emptyAttempt(), 'q1', pick('o1'))
    s = recordAnswer(s, 'q1', pick('o2')) // local rev 2, unsent
    s = mergeServerCopy(s, [
      { questionId: 'q1', optionId: 'o1', text: null, rev: 1 },
      { questionId: 'q2', optionId: null, text: 'from the server', rev: 3 },
    ])
    expect(s.answers.q1).toEqual({ optionId: 'o2', text: null, rev: 2, sentRev: 0 })
    expect(s.answers.q2).toEqual({ optionId: null, text: 'from the server', rev: 3, sentRev: 3 })
    expect(pendingAnswers(s)).toEqual([{ questionId: 'q1', optionId: 'o2', text: null, rev: 2 }])
  })

  it('the server copy wins at an equal or higher rev and is then not pending', () => {
    let s = recordAnswer(emptyAttempt(), 'q1', pick('o1'))
    s = mergeServerCopy(s, [{ questionId: 'q1', optionId: 'o9', text: null, rev: 1 }])
    expect(s.answers.q1).toEqual({ optionId: 'o9', text: null, rev: 1, sentRev: 1 })
    s = mergeServerCopy(s, [{ questionId: 'q1', optionId: 'o7', text: null, rev: 4 }])
    expect(s.answers.q1).toEqual({ optionId: 'o7', text: null, rev: 4, sentRev: 4 })
    expect(pendingAnswers(s)).toEqual([])
    // the next local change follows on from the server's rev
    expect(recordAnswer(s, 'q1', pick('o1')).answers.q1.rev).toBe(5)
  })

  it('keeps leave reports and the open exit', () => {
    const s = recordLeaveEvent(emptyAttempt(), { type: 'left', exitId: EXIT_A, leftAtEpochMs: 5 })
    const merged = mergeServerCopy(s, [])
    expect(merged.exits).toEqual(s.exits)
    expect(merged.openExit).toEqual(s.openExit)
  })
})
