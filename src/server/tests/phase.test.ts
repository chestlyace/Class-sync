import { describe, expect, it } from 'vitest'
import {
  acceptsAnswers,
  answersFinalAt,
  canSeeResult,
  endsAt,
  testPhase,
  testState,
  type TestTiming,
} from './phase'

const at = (time: string) => new Date(`2026-11-09T${time.length === 5 ? `${time}:00` : time}Z`)

const notStarted: TestTiming = { startedAt: null, deadlineAt: null, endedAt: null }
const t: TestTiming = { startedAt: at('08:00'), deadlineAt: at('08:30'), endedAt: null }
const ended: TestTiming = { ...t, endedAt: at('08:30') }
const open = { closedAt: null, closedReason: null }

describe('testPhase', () => {
  it('is not_started until Start', () => {
    expect(testPhase(notStarted, at('09:00'))).toBe('not_started')
    expect(testPhase(t, at('07:59'))).toBe('not_started')
  })

  it('runs from Start until the deadline', () => {
    expect(testPhase(t, at('08:00'))).toBe('running')
    expect(testPhase(t, at('08:29:59'))).toBe('running')
    expect(testPhase(t, at('08:30'))).toBe('ended')
  })

  it('ends early when the lecturer ends it', () => {
    const early = { ...t, endedAt: at('08:20') }
    expect(testPhase(early, at('08:19:59'))).toBe('running')
    expect(testPhase(early, at('08:20'))).toBe('ended')
  })
})

describe('endsAt and answersFinalAt', () => {
  it('is the earlier of the deadline and the manual end', () => {
    expect(endsAt(t)).toEqual(at('08:30'))
    expect(endsAt({ ...t, endedAt: at('08:20') })).toEqual(at('08:20'))
    expect(endsAt({ ...t, endedAt: at('08:40') })).toEqual(at('08:30'))
    expect(endsAt(notStarted)).toBeNull()
  })

  it('adds the 2-minute grace', () => {
    expect(answersFinalAt(t)).toEqual(at('08:32'))
    expect(answersFinalAt({ ...t, endedAt: at('08:20') })).toEqual(at('08:22'))
    expect(answersFinalAt(notStarted)).toBeNull()
  })
})

describe('acceptsAnswers', () => {
  it('takes no answers before Start', () => {
    expect(acceptsAnswers(notStarted, open, at('07:59'))).toBe(false)
    expect(acceptsAnswers(t, open, at('07:59'))).toBe(false)
  })

  it('takes answers while running and within the grace after the end', () => {
    expect(acceptsAnswers(t, open, at('08:15'))).toBe(true)
    expect(acceptsAnswers(t, open, at('08:31:59'))).toBe(true)
    expect(acceptsAnswers(t, open, at('08:32'))).toBe(false)
    expect(acceptsAnswers(t, open, at('08:32:01'))).toBe(false)
  })

  it('takes answers within 2 minutes of being ended for leaving', () => {
    const left = { closedAt: at('08:10'), closedReason: 'left' as const }
    expect(acceptsAnswers(t, left, at('08:11'))).toBe(true)
    expect(acceptsAnswers(t, left, at('08:12:01'))).toBe(false)
  })

  it('never goes past the test grace, even for a recent leaving', () => {
    const left = { closedAt: at('08:20'), closedReason: 'left' as const }
    const early = { ...t, endedAt: at('08:19') }
    expect(acceptsAnswers(early, left, at('08:21:30'))).toBe(false)
  })

  it('a hand-in is final', () => {
    expect(
      acceptsAnswers(t, { closedAt: at('08:10'), closedReason: 'handed_in' }, at('08:10:01')),
    ).toBe(false)
  })
})

describe('testState', () => {
  it('follows the phase before the end', () => {
    expect(
      testState({ ...notStarted, hasShort: false, resultsReleasedAt: null }, at('07:00')),
    ).toBe('not_started')
    expect(testState({ ...t, hasShort: false, resultsReleasedAt: null }, at('08:10'))).toBe(
      'running',
    )
  })

  it('MCQ-only is released as soon as it ends', () => {
    expect(testState({ ...ended, hasShort: false, resultsReleasedAt: null }, at('08:31'))).toBe(
      'released',
    )
  })

  it('with short answers waits for the lecturer', () => {
    expect(testState({ ...ended, hasShort: true, resultsReleasedAt: null }, at('08:31'))).toBe(
      'ended',
    )
    expect(
      testState({ ...ended, hasShort: true, resultsReleasedAt: at('09:00') }, at('09:01')),
    ).toBe('released')
  })
})

describe('canSeeResult', () => {
  it('MCQ-only: at once after a hand-in', () => {
    expect(
      canSeeResult({
        hasShort: false,
        phase: 'running',
        closedReason: 'handed_in',
        released: false,
      }),
    ).toBe(true)
  })

  it('MCQ-only: ended for leaving sees it only once the test ended for everyone', () => {
    expect(
      canSeeResult({ hasShort: false, phase: 'running', closedReason: 'left', released: false }),
    ).toBe(false)
    expect(
      canSeeResult({ hasShort: false, phase: 'ended', closedReason: 'left', released: false }),
    ).toBe(true)
  })

  it('MCQ-only: still working sees nothing until the end', () => {
    expect(
      canSeeResult({ hasShort: false, phase: 'running', closedReason: null, released: false }),
    ).toBe(false)
    expect(
      canSeeResult({ hasShort: false, phase: 'ended', closedReason: null, released: false }),
    ).toBe(true)
  })

  it('with short answers: only after release', () => {
    expect(
      canSeeResult({ hasShort: true, phase: 'ended', closedReason: 'handed_in', released: false }),
    ).toBe(false)
    expect(
      canSeeResult({ hasShort: true, phase: 'ended', closedReason: 'handed_in', released: true }),
    ).toBe(true)
  })
})
