import { describe, expect, it } from 'vitest'
import type { ExitReport } from './sync-payload'
import {
  allAnswers,
  armsLeaving,
  clearsLocalCopy,
  endReason,
  exitCount,
  formatCountdown,
  keepSyncing,
  localVerdict,
  navigationFor,
  pickClockSample,
  RELOAD_GAP_MS,
  resolveOpenExit,
  spokenSyncStatus,
  tracksLeaving,
  resultState,
  retryDelayMs,
  screenFor,
  settleFinalAnswers,
  syncDueAt,
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
    expect(keepSyncing({ ...v, stage: 'handed_in', hasShort: true, awaitingRelease: true }, false)).toBe(false)
    expect(keepSyncing({ ...v, stage: 'over', attemptId: null }, false)).toBe(false)
  })

  it('stops once a result shows, even with answers still queued (the server no longer takes them)', () => {
    const score = { score: 1, outOf: 2, mcqCorrect: 1, mcqCount: 1 }
    expect(keepSyncing({ ...v, stage: 'over', result: score }, true)).toBe(false)
    expect(keepSyncing({ ...v, stage: 'handed_in', result: score }, true)).toBe(false)
  })

  it('keeps sending queued answers after the end while no result shows (the grace)', () => {
    expect(keepSyncing({ ...v, stage: 'over' }, true)).toBe(true)
    expect(keepSyncing({ ...v, stage: 'handed_in', hasShort: true, awaitingRelease: true }, true)).toBe(true)
  })
})

describe('settleFinalAnswers', () => {
  const pending = (rev: number, sentRev = 0) => ({ optionId: 'o1', text: null, rev, sentRev })
  const state = { answers: { q1: pending(2), q2: pending(3, 1), q3: pending(1, 1) }, exits: [], openExit: null }
  const sent = [
    { questionId: 'q1', optionId: 'o1', text: null, rev: 2 },
    { questionId: 'q2', optionId: 'o1', text: null, rev: 2 },
  ]
  const noResult = { result: null }
  const score = { score: 1, outOf: 2, mcqCorrect: 1, mcqCount: 1 }

  it('after the end or a hand-in: answers sent and not taken are final (the server dropped them)', () => {
    for (const stage of ['over', 'handed_in'] as const) {
      const settled = settleFinalAnswers(state, { stage, ...noResult }, sent)
      expect(settled.answers.q1).toEqual(pending(2, 2))
      // Changed since it was sent: still goes out once more.
      expect(settled.answers.q2).toEqual(pending(3, 1))
      expect(settled.answers.q3).toEqual(pending(1, 1))
    }
  })

  it('never while the attempt may still take them', () => {
    for (const stage of ['waiting', 'answering', 'ended_left'] as const) {
      expect(settleFinalAnswers(state, { stage, ...noResult }, sent)).toBe(state)
    }
  })

  it('once a result shows, every queued answer is final, sent or not', () => {
    const settled = settleFinalAnswers(state, { stage: 'over', result: score }, [])
    expect(Object.values(settled.answers).every((a) => a.sentRev === a.rev)).toBe(true)
  })

  it('returns the same state when nothing changes', () => {
    const done = { ...state, answers: { q3: pending(1, 1) } }
    expect(settleFinalAnswers(done, { stage: 'over', result: score }, [])).toBe(done)
  })
})

describe('syncDueAt', () => {
  it('a new timer replaces the current one, or keeps the sooner when asked', () => {
    expect(syncDueAt(null, 1000, 5000, true)).toBe(6000)
    expect(syncDueAt(1600, 1000, 5000, false)).toBe(6000)
    // An answer timer due in 600 ms is not pushed back by the regular 5 s sync.
    expect(syncDueAt(1600, 1000, 5000, true)).toBe(1600)
    expect(syncDueAt(9000, 1000, 5000, true)).toBe(6000)
  })
})

describe('when leaving counts (C1)', () => {
  const answering = { stage: 'answering' as const, verdict: 'continue' as const, timeUp: false, fatal: false }

  it('tracks only while answering, still allowed, before time is up', () => {
    expect(tracksLeaving(answering)).toBe(true)
    expect(tracksLeaving({ ...answering, stage: 'waiting' })).toBe(false)
    expect(tracksLeaving({ ...answering, stage: 'ended_left' })).toBe(false)
    expect(tracksLeaving({ ...answering, verdict: 'end_exits' })).toBe(false)
    expect(tracksLeaving({ ...answering, timeUp: true })).toBe(false)
    expect(tracksLeaving({ ...answering, fatal: true })).toBe(false)
  })

  it('arms only on the questions screen: not while waiting, on Begin, or on a notice', () => {
    expect(armsLeaving('question')).toBe(true)
    expect(armsLeaving('warning')).toBe(true)
    for (const screen of ['waiting', 'begin', 'ended', 'result', 'closed'] as const) expect(armsLeaving(screen)).toBe(false)
  })
})

describe('navigationFor', () => {
  const base = { timeOriginMs: 1000, currentPath: '/t/ABC123', mountedAtMs: 9000 }

  it('a full load of this page: its navigation type, started at the time origin', () => {
    expect(navigationFor({ ...base, entry: { type: 'reload', url: 'https://x.test/t/ABC123' } })).toEqual({ type: 'reload', startMs: 1000 })
    expect(navigationFor({ ...base, entry: { type: 'navigate', url: 'https://x.test/t/ABC123?x=1' } })).toEqual({ type: 'navigate', startMs: 1000 })
  })

  it('reached in the app from another page (after sign-in): no type, started when the runner mounted', () => {
    expect(navigationFor({ ...base, entry: { type: 'reload', url: 'https://x.test/sign-in?next=x' } })).toEqual({ type: null, startMs: 9000 })
    expect(navigationFor({ ...base, entry: null })).toEqual({ type: null, startMs: 9000 })
    expect(navigationFor({ ...base, entry: { type: 'navigate', url: 'not a url' } })).toEqual({ type: null, startMs: 9000 })
  })
})

describe('resolveOpenExit (I1: a reload is not leaving; a closed tab still is)', () => {
  const openExit = { exitId: 'x', leftAtEpochMs: 100_000 }

  it('a same-tab reload whose left report never reached the server is dropped: not an exit', () => {
    // Pull-to-refresh: the new page started before the old one unloaded.
    const nav = { type: 'reload', startMs: 97_000 }
    expect(resolveOpenExit({ openExit, nav, visible: true, leftQueued: true })).toEqual({ kind: 'drop' })
    expect(resolveOpenExit({ openExit, nav: { type: 'reload', startMs: 100_000 + RELOAD_GAP_MS }, visible: true, leftQueued: true })).toEqual({
      kind: 'drop',
    })
  })

  it('a reload whose left the server already has comes back at once, measured to the new page start', () => {
    expect(resolveOpenExit({ openExit, nav: { type: 'reload', startMs: 101_000 }, visible: true, leftQueued: false })).toEqual({
      kind: 'back',
      awayMs: 1000,
    })
    expect(resolveOpenExit({ openExit, nav: { type: 'reload', startMs: 97_000 }, visible: false, leftQueued: false })).toEqual({
      kind: 'back',
      awayMs: 0,
    })
  })

  it('a "reload" long after leaving (a discarded tab reloaded on return) still counts', () => {
    expect(
      resolveOpenExit({ openExit, nav: { type: 'reload', startMs: 100_000 + RELOAD_GAP_MS + 1 }, visible: true, leftQueued: true }),
    ).toEqual({ kind: 'back', awayMs: RELOAD_GAP_MS + 1 })
  })

  it('a closed tab reopened counts, with the absence up to the new page start (not until the server answers)', () => {
    expect(resolveOpenExit({ openExit, nav: { type: 'navigate', startMs: 130_000 }, visible: true, leftQueued: true })).toEqual({
      kind: 'back',
      awayMs: 30_000,
    })
    expect(resolveOpenExit({ openExit, nav: { type: null, startMs: 130_000 }, visible: true, leftQueued: false })).toEqual({
      kind: 'back',
      awayMs: 30_000,
    })
  })

  it('reopened in a background tab: judged when the page shows', () => {
    expect(resolveOpenExit({ openExit, nav: { type: 'navigate', startMs: 130_000 }, visible: false, leftQueued: true })).toEqual({
      kind: 'wait',
    })
  })
})

describe('spokenSyncStatus (minor 3: only problems, and the return to Saved after one)', () => {
  it('says nothing for the Saved / Saving round of every answer', () => {
    expect(spokenSyncStatus(null, 'saving')).toBeNull()
    expect(spokenSyncStatus(null, 'saved')).toBeNull()
  })

  it('says each problem, and Saved once after a problem', () => {
    expect(spokenSyncStatus(null, 'offline')).toBe('offline')
    expect(spokenSyncStatus('offline', 'saving')).toBe('offline')
    expect(spokenSyncStatus('offline', 'failed')).toBe('failed')
    expect(spokenSyncStatus('failed', 'saved')).toBe('saved')
    expect(spokenSyncStatus('saved', 'saving')).toBe('saved')
    expect(spokenSyncStatus('saved', 'saved')).toBeNull()
    expect(spokenSyncStatus('saved', 'signed_out')).toBe('signed_out')
  })
})

describe('clearsLocalCopy (minor 13)', () => {
  const view = { stage: 'over' as const, attemptId: 'a', hasShort: false, result: null, awaitingRelease: false }

  it('after a hand-in, once a result shows, or once nothing more will be sent', () => {
    expect(clearsLocalCopy({ ...view, stage: 'handed_in', result: { score: 1, outOf: 2, mcqCorrect: 1, mcqCount: 2 } }, true)).toBe(true)
    expect(clearsLocalCopy({ ...view, result: { score: 1, outOf: 2, mcqCorrect: 1, mcqCount: 2 } }, false)).toBe(true)
    expect(clearsLocalCopy({ ...view, hasShort: true, awaitingRelease: true }, false)).toBe(true)
  })

  it('never while answers are still queued or the attempt may reopen', () => {
    expect(clearsLocalCopy({ ...view, hasShort: true, awaitingRelease: true }, true)).toBe(false)
    expect(clearsLocalCopy({ ...view, stage: 'ended_left' }, false)).toBe(false)
    expect(clearsLocalCopy({ ...view, stage: 'answering' }, false)).toBe(false)
    expect(clearsLocalCopy({ ...view, stage: 'waiting' }, false)).toBe(false)
  })
})
