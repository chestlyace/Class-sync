import { describe, expect, it } from 'vitest'
import type { ExitReport } from './sync-payload'
import {
  allAnswers,
  endReason,
  exitCount,
  formatCountdown,
  keepSyncing,
  localVerdict,
  pickClockSample,
  resultState,
  retryDelayMs,
  screenFor,
  type ScreenInput,
} from './runner-logic'

const rule = { maxExits: 3, maxAbsenceSeconds: 10 }
const left = (exitId: string): ExitReport => ({ exitId, phase: 'left', awayMs: null })
const back = (exitId: string, awayMs: number): ExitReport => ({ exitId, phase: 'back', awayMs })

describe('pickClockSample', () => {
  it('takes the first sample', () => {
    expect(pickClockSample(null, { offsetMs: 500, rttMs: 4000 })).toEqual({ offsetMs: 500, rttMs: 4000 })
  })

  it('keeps the lowest round trip: a slow sample does not replace a fast one', () => {
    const fast = { offsetMs: 1000, rttMs: 80 }
    expect(pickClockSample(fast, { offsetMs: 2500, rttMs: 3000 })).toBe(fast)
    expect(pickClockSample(fast, { offsetMs: 1010, rttMs: 60 })).toEqual({ offsetMs: 1010, rttMs: 60 })
  })

  it('takes a slower sample when the device clock has clearly jumped', () => {
    const fast = { offsetMs: 1000, rttMs: 80 }
    // Ranges [960, 1040] and [3_598_000, 3_602_000] cannot both hold: the device clock changed.
    expect(pickClockSample(fast, { offsetMs: 3_600_000, rttMs: 4000 })).toEqual({ offsetMs: 3_600_000, rttMs: 4000 })
  })
})

describe('retryDelayMs', () => {
  it('backs off from 2 s to 30 s after failures, and uses the sync interval otherwise', () => {
    expect(retryDelayMs(0)).toBe(5000)
    expect([1, 2, 3, 4, 5, 9].map(retryDelayMs)).toEqual([2000, 4000, 8000, 16_000, 30_000, 30_000])
  })
})

describe('exit counting and the local verdict', () => {
  it('counts queued exits the server has not counted yet, once each', () => {
    expect(exitCount(1, [left('a'), back('a', 2000), left('b')])).toBe(3)
    // A queued back whose left was acknowledged is already in the server count.
    expect(exitCount(1, [back('a', 2000)])).toBe(1)
  })

  it('ends at the Nth exit at once, offline', () => {
    expect(localVerdict(rule, 2, [left('c')])).toBe('end_exits')
    expect(localVerdict(rule, 1, [left('b')])).toBe('continue')
  })

  it('ends on an absence longer than S; exactly S is allowed', () => {
    expect(localVerdict(rule, 0, [left('a'), back('a', 10_000)])).toBe('continue')
    expect(localVerdict(rule, 0, [left('a'), back('a', 10_001)])).toBe('end_absence')
    expect(localVerdict(rule, 1, [back('a', 12_000)])).toBe('end_absence')
  })

  it('names the reason of a server-side ending from the count', () => {
    expect(endReason(rule, 3)).toBe('exits')
    expect(endReason(rule, 1)).toBe('absence')
  })
})

describe('formatCountdown', () => {
  it('rounds up to whole seconds, with hours when needed', () => {
    expect(formatCountdown(0)).toBe('00:00')
    expect(formatCountdown(1)).toBe('00:01')
    expect(formatCountdown(65_000)).toBe('01:05')
    expect(formatCountdown(3_725_000)).toBe('1:02:05')
  })
})

describe('allAnswers', () => {
  it('lists every local answer for the hand-in', () => {
    const state = {
      answers: {
        q1: { optionId: 'o1', text: null, rev: 2, sentRev: 2 },
        q2: { optionId: null, text: 'osmosis', rev: 1, sentRev: 0 },
      },
      exits: [],
      openExit: null,
    }
    expect(allAnswers(state)).toEqual([
      { questionId: 'q1', optionId: 'o1', text: null, rev: 2 },
      { questionId: 'q2', optionId: null, text: 'osmosis', rev: 1 },
    ])
  })
})

const base: ScreenInput = {
  stage: 'answering',
  attemptId: 'a1',
  verdict: 'continue',
  needsBegin: false,
  hasWarning: false,
  timeUp: false,
}

describe('screenFor', () => {
  it('waiting before Start', () => {
    expect(screenFor({ ...base, stage: 'waiting' })).toBe('waiting')
  })

  it('a local ending wins over everything while answering (offline)', () => {
    expect(screenFor({ ...base, verdict: 'end_exits', hasWarning: true, needsBegin: true })).toBe('ended')
  })

  it('warning, then Begin, then the questions', () => {
    expect(screenFor({ ...base, hasWarning: true, needsBegin: true })).toBe('warning')
    expect(screenFor({ ...base, needsBegin: true })).toBe('begin')
    expect(screenFor(base)).toBe('question')
  })

  it('time up shows the locked questions, never a warning or Begin', () => {
    expect(screenFor({ ...base, timeUp: true, hasWarning: true, needsBegin: true })).toBe('question')
  })

  it('ended for leaving, handed in, and over', () => {
    expect(screenFor({ ...base, stage: 'ended_left' })).toBe('ended')
    expect(screenFor({ ...base, stage: 'handed_in' })).toBe('result')
    expect(screenFor({ ...base, stage: 'over' })).toBe('result')
    expect(screenFor({ ...base, stage: 'over', attemptId: null })).toBe('closed')
  })
})

describe('resultState', () => {
  const score = { score: 16, outOf: 20, mcqCorrect: 8, mcqCount: 10 }
  it('MCQ-only: the total once it is final, "in a moment" before', () => {
    expect(resultState({ hasShort: false, result: score })).toBe('score')
    expect(resultState({ hasShort: false, result: null })).toBe('pending')
  })

  it('with short answers: waits for release, then the total', () => {
    expect(resultState({ hasShort: true, result: null })).toBe('awaiting_release')
    expect(resultState({ hasShort: true, result: score })).toBe('score')
  })
})

describe('keepSyncing', () => {
  const v = { attemptId: 'a1', hasShort: false, result: null, awaitingRelease: false }
  it('while waiting, answering or ended for leaving (it may reopen)', () => {
    for (const stage of ['waiting', 'answering', 'ended_left'] as const) {
      expect(keepSyncing({ ...v, stage }, false)).toBe(true)
    }
  })

  it('after the end: until answers are sent and the MCQ total has arrived', () => {
    expect(keepSyncing({ ...v, stage: 'over' }, false)).toBe(true) // total still to come
    const score = { score: 1, outOf: 2, mcqCorrect: 1, mcqCount: 1 }
    expect(keepSyncing({ ...v, stage: 'over', result: score }, false)).toBe(false)
    expect(keepSyncing({ ...v, stage: 'over', result: score }, true)).toBe(true)
    expect(keepSyncing({ ...v, stage: 'handed_in', hasShort: true, awaitingRelease: true }, false)).toBe(false)
    expect(keepSyncing({ ...v, stage: 'over', attemptId: null }, false)).toBe(false)
  })
})
