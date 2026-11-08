'use client'

import { useCallback, useEffect, useEffectEvent, useRef, useState, useSyncExternalStore } from 'react'
import type { ActionResult } from '@/lib/action-result'
import { createLeaveTracker, type LeaveEvent, type LeaveSignal } from './leave-tracker'
import {
  acknowledge,
  answeredCount,
  attemptKey,
  clearLocalAttempt,
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
import { handInAction, openTestAction, syncAttemptAction } from './actions'
import { getDeviceId, randomUuid } from './device-id'
import { EndedScreen } from './ended-screen'
import { BeginScreen, LoadingScreen, NoticeScreen } from './notice-screen'
import { QuestionScreen, type HandInProblem } from './question-screen'
import { ResultScreen } from './result-screen'
import {
  allAnswers,
  endReason,
  exitCount,
  keepSyncing,
  localVerdict,
  pickClockSample,
  retryDelayMs,
  screenFor,
  type ClockSample,
} from './runner-logic'
import type { SyncStatus } from './screen-parts'
import { clockOffsetMs, msLeft as msLeftUntil } from './server-clock'
import type { AttemptViewDto } from './view-dto'
import { WaitingScreen } from './waiting-screen'
import { WarningScreen } from './warning-screen'

/** Sync this long after an answer changes (typing coalesces; a tap goes out almost at once). */
const ANSWER_DEBOUNCE_MS = 600

type Fatal = 'open_elsewhere' | 'open_failed' | 'not_your_course'
type Device = { laptop: boolean; canFullscreen: boolean }
/** The warning after leaving: `awayMs` null while still away (out of full screen on a laptop). */
type Warning = { exitNumber: number; leftAtEpochMs: number; awayMs: number | null }

let deviceSnapshot: Device | null = null

/** Read once in the browser (null on the server): pointer type and full screen support do not change. */
function readDevice(): Device {
  deviceSnapshot ??= {
    laptop: window.matchMedia('(pointer: fine)').matches,
    canFullscreen: document.fullscreenEnabled === true && typeof document.documentElement.requestFullscreen === 'function',
  }
  return deviceSnapshot
}

const noSubscription = () => () => {}

function subscribeFullscreen(onChange: () => void) {
  document.addEventListener('fullscreenchange', onChange)
  return () => document.removeEventListener('fullscreenchange', onChange)
}

function hasQueued(state: LocalAttempt): boolean {
  return pendingAnswers(state).length > 0 || state.exits.length > 0
}

function isOpenElsewhere(result: ActionResult<unknown>): boolean {
  return !result.ok && result.code === 'CONFLICT' && result.details?.reason === 'open_elsewhere'
}

/**
 * The student's side of a test. The server decides (stage, deadline, result); this keeps every
 * answer and leave report on the device first (localStorage, written synchronously), sends them
 * with `syncAttemptAction` (every STUDENT_SYNC_MS, soon after each answer, at once after each exit,
 * on `online` and on return), and judges leaving locally too so an ended student sees it offline.
 * A failed request is never leaving: it only changes the "saved on this phone" line.
 */
export function TestRunner({ userId, code }: { userId: string; code: string }) {
  const [view, setView] = useState<AttemptViewDto | null>(null)
  const [fatal, setFatal] = useState<Fatal | null>(null)
  const [local, setLocal] = useState<LocalAttempt>(emptyAttempt)
  const [status, setStatus] = useState<SyncStatus>('saved')
  const [offsetMs, setOffsetMs] = useState(0)
  const [nowMs, setNowMs] = useState(() => Date.now())
  const device = useSyncExternalStore<Device | null>(noSubscription, readDevice, () => null)
  const [begun, setBegun] = useState(false)
  /** Full screen was entered with the Begin tap: leaving it now counts. */
  const [fullscreenMode, setFullscreenMode] = useState(false)
  const isFullscreen = useSyncExternalStore(
    subscribeFullscreen,
    () => document.fullscreenElement !== null,
    () => false,
  )
  const [warning, setWarning] = useState<Warning | null>(null)
  const [index, setIndex] = useState(0)
  const [handingIn, setHandingIn] = useState(false)
  const [handInProblem, setHandInProblem] = useState<HandInProblem>(null)

  // The latest values for event handlers and timers (state is for rendering).
  const viewRef = useRef<AttemptViewDto | null>(null)
  const localRef = useRef<LocalAttempt>(emptyAttempt())
  const keyRef = useRef<string | null>(null)
  const deviceIdRef = useRef('')
  const clockRef = useRef<ClockSample | null>(null)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const syncRef = useRef<() => Promise<void>>(async () => {})
  const inFlightRef = useRef(false)
  const againRef = useRef(false)
  const failuresRef = useRef(0)
  const stoppedRef = useRef(false)
  /** "Back to full screen" was pressed: the `back` it causes goes straight to the questions. */
  const resumingRef = useRef(false)

  /** The one way local state changes: kept in the ref, written to localStorage at once, rendered. */
  const commit = useCallback((next: LocalAttempt) => {
    localRef.current = next
    if (keyRef.current) saveLocalAttempt(keyRef.current, next)
    setLocal(next)
  }, [])

  const applyView = useCallback((dto: AttemptViewDto, sentAtMs: number, receivedAtMs: number) => {
    const sample = { offsetMs: clockOffsetMs(dto.serverNow, sentAtMs, receivedAtMs), rttMs: receivedAtMs - sentAtMs }
    clockRef.current = pickClockSample(clockRef.current, sample)
    setOffsetMs(clockRef.current.offsetMs)
    viewRef.current = dto
    setView(dto)
  }, [])

  const stop = useCallback((reason: Fatal) => {
    stoppedRef.current = true
    if (timerRef.current) clearTimeout(timerRef.current)
    setFatal(reason)
  }, [])

  // ------------------------------------------------------------------------------------------
  // Talking to the server
  // ------------------------------------------------------------------------------------------

  const schedule = useCallback((delayMs: number) => {
    if (timerRef.current) clearTimeout(timerRef.current)
    if (stoppedRef.current) return
    timerRef.current = setTimeout(() => void syncRef.current(), delayMs)
  }, [])

  const sync = useCallback(async (): Promise<void> => {
    const v = viewRef.current
    if (stoppedRef.current || !v?.attemptId) return
    if (!keepSyncing({ ...v, hasShort: v.info.hasShort }, hasQueued(localRef.current))) return
    if (inFlightRef.current) {
      againRef.current = true
      return
    }
    inFlightRef.current = true
    const state = localRef.current
    const answers = pendingAnswers(state)
    const exits = pendingExits(state)
    if (answers.length > 0 || exits.length > 0) setStatus((s) => (s === 'saved' ? 'saving' : s))
    const sentAt = Date.now()
    let ok = false
    try {
      const result = await syncAttemptAction(v.attemptId, { deviceId: deviceIdRef.current, answers, exits })
      const receivedAt = Date.now()
      if (result.ok) {
        ok = true
        failuresRef.current = 0
        // Exactly the reports sent: one id per report (a left and its back share an id).
        commit(acknowledge(localRef.current, result.data.acceptedRevs, exits.map((e) => e.exitId)))
        applyView(result.data, sentAt, receivedAt)
        setStatus(hasQueued(localRef.current) ? 'saving' : 'saved')
      } else if (isOpenElsewhere(result)) {
        stop('open_elsewhere')
      } else if (result.code === 'FORBIDDEN') {
        stop('not_your_course')
      } else {
        failuresRef.current += 1
        setStatus(result.code === 'UNAUTHENTICATED' ? 'signed_out' : 'failed')
      }
    } catch {
      // No connection (or the request was cut): everything stays queued on the device.
      failuresRef.current += 1
      setStatus('offline')
    } finally {
      inFlightRef.current = false
    }
    if (ok && againRef.current) {
      againRef.current = false
      schedule(0)
    } else {
      againRef.current = false
      schedule(retryDelayMs(failuresRef.current))
    }
  }, [applyView, commit, schedule, stop])
  useEffect(() => {
    syncRef.current = sync
  }, [sync])

  const open = useCallback(async () => {
    stoppedRef.current = false
    const sentAt = Date.now()
    try {
      const result = await openTestAction(code, deviceIdRef.current)
      const receivedAt = Date.now()
      if (!result.ok) {
        if (isOpenElsewhere(result)) setFatal('open_elsewhere')
        else setFatal(result.code === 'FORBIDDEN' ? 'not_your_course' : 'open_failed')
        return
      }
      setFatal(null)
      const dto = result.data
      if (dto.attemptId) {
        keyRef.current = attemptKey(userId, dto.attemptId)
        // The server's copy first, before any answer can be recorded: a newer local answer is kept.
        commit(mergeServerCopy(loadLocalAttempt(keyRef.current), dto.saved))
      }
      applyView(dto, sentAt, receivedAt)
      setStatus(hasQueued(localRef.current) ? 'saving' : 'saved')
      // Queued answers and leave reports (from before a reload) go out at once.
      schedule(hasQueued(localRef.current) ? 0 : retryDelayMs(0))
    } catch {
      setFatal('open_failed')
    }
  }, [applyView, code, commit, schedule, userId])

  const onMount = useEffectEvent(() => {
    deviceIdRef.current = getDeviceId()
    void open()
  })

  useEffect(() => {
    // Starts the first request; state is only set once it answers (the rule cannot see past `await`).
    // eslint-disable-next-line react-hooks/set-state-in-effect
    onMount()
    const tick = setInterval(() => setNowMs(Date.now()), 1000)
    return () => {
      clearInterval(tick)
      if (timerRef.current) clearTimeout(timerRef.current)
    }
  }, [])

  // Back online, or back on the page: sync at once (a retry, never a leave report).
  const syncSoon = useEffectEvent(() => {
    if (fatal === 'open_failed') void open()
    else if (view?.attemptId) schedule(0)
  })
  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState === 'visible') syncSoon()
    }
    window.addEventListener('online', syncSoon)
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      window.removeEventListener('online', syncSoon)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [])

  // ------------------------------------------------------------------------------------------
  // Where the student is
  // ------------------------------------------------------------------------------------------

  const rule = view?.info.rule ?? { maxExits: 1, maxAbsenceSeconds: 0 }
  const verdict = view ? localVerdict(rule, view.exitsSoFar, local.exits) : 'continue'
  const msLeft = view?.endsAt ? msLeftUntil(view.endsAt, offsetMs, nowMs) : 0
  const timeUp = view?.stage === 'answering' && view.endsAt !== null && msLeft === 0
  const needsBegin = device !== null && device.laptop && device.canFullscreen && !begun
  /** Leaving counts only while answering: not before Start, after the end, a hand-in or an ending. */
  const tracking = view?.stage === 'answering' && verdict === 'continue' && !timeUp && fatal === null

  const onLeaveEvent = useEffectEvent((event: LeaveEvent) => {
    const v = viewRef.current
    if (!v) return
    // Stored before anything else: a tab closed right after this still reports the exit on reopening.
    const next = recordLeaveEvent(localRef.current, event)
    commit(next)
    if (localVerdict(v.info.rule, v.exitsSoFar, next.exits) === 'continue') {
      const exitNumber = exitCount(v.exitsSoFar, next.exits)
      if (event.type === 'left') {
        setWarning({ exitNumber, leftAtEpochMs: event.leftAtEpochMs, awayMs: null })
      } else if (resumingRef.current) {
        resumingRef.current = false
        setWarning(null)
      } else {
        setWarning({ exitNumber, leftAtEpochMs: Date.now() - event.awayMs, awayMs: event.awayMs })
      }
    }
    schedule(0)
  })

  const onPageHide = useEffectEvent(() => {
    if (keyRef.current) saveLocalAttempt(keyRef.current, localRef.current)
  })

  useEffect(() => {
    if (!tracking || device === null) return
    const tracker = createLeaveTracker({
      countsFocus: device.laptop,
      countsFullscreen: fullscreenMode,
      now: Date.now,
      newId: randomUuid,
      openExit: localRef.current.openExit,
    })
    const feed = (signal: LeaveSignal) => {
      const event = tracker.handle(signal)
      if (event) onLeaveEvent(event)
    }
    const visibility = (): LeaveSignal => (document.visibilityState === 'hidden' ? 'hidden' : 'visible')
    // The state right now (a tab closed mid-test is judged here, on reopening). Focus is not read
    // here: a page often loads without focus (address bar, a link opened from another app), and
    // counting that as leaving would be unfair; only a real `blur` after this counts.
    feed(visibility())
    if (fullscreenMode) feed(document.fullscreenElement ? 'fullscreen_enter' : 'fullscreen_exit')

    const onVisibility = () => feed(visibility())
    // A page restored from the back/forward cache may skip visibilitychange.
    const onPageShow = () => feed(visibility())
    const onHide = () => {
      feed('pagehide')
      onPageHide()
    }
    const onBlur = () => feed('blur')
    const onFocus = () => feed('focus')
    const onFullscreen = () => {
      if (fullscreenMode) feed(document.fullscreenElement ? 'fullscreen_enter' : 'fullscreen_exit')
    }
    document.addEventListener('visibilitychange', onVisibility)
    window.addEventListener('pageshow', onPageShow)
    window.addEventListener('pagehide', onHide)
    window.addEventListener('blur', onBlur)
    window.addEventListener('focus', onFocus)
    document.addEventListener('fullscreenchange', onFullscreen)
    return () => {
      document.removeEventListener('visibilitychange', onVisibility)
      window.removeEventListener('pageshow', onPageShow)
      window.removeEventListener('pagehide', onHide)
      window.removeEventListener('blur', onBlur)
      window.removeEventListener('focus', onFocus)
      document.removeEventListener('fullscreenchange', onFullscreen)
    }
  }, [tracking, device, fullscreenMode])

  // Out of answering (ended, handed in, time up): an exit still open no longer counts, and full
  // screen is released. Otherwise a stale exit would be judged if the lecturer lets the student back in.
  // Full screen mode ends with it: a student let back in taps Begin again to re-enter full screen,
  // rather than the reopened tracker counting "out of full screen" as a fresh exit.
  const onStopTracking = useEffectEvent(() => {
    if (localRef.current.openExit) commit({ ...localRef.current, openExit: null })
    setWarning(null)
    setFullscreenMode(false)
    setBegun(false)
    if (document.fullscreenElement) void document.exitFullscreen().catch(() => {})
  })
  useEffect(() => {
    if (view !== null && !tracking) onStopTracking()
  }, [view, tracking])

  // Handed in: final on the server, nothing left to keep on the device.
  useEffect(() => {
    if (view?.stage !== 'handed_in' || !keyRef.current) return
    clearLocalAttempt(keyRef.current)
    keyRef.current = null
  }, [view?.stage])

  // ------------------------------------------------------------------------------------------
  // Actions from the screens
  // ------------------------------------------------------------------------------------------

  function onAnswer(questionId: string, value: { optionId: string | null; text: string | null }) {
    if (!tracking) return
    commit(recordAnswer(localRef.current, questionId, value))
    setStatus((s) => (s === 'saved' ? 'saving' : s))
    schedule(ANSWER_DEBOUNCE_MS)
  }

  async function onHandIn(): Promise<boolean> {
    const v = viewRef.current
    if (!v?.attemptId) return false
    setHandingIn(true)
    setHandInProblem(null)
    const state = localRef.current
    const exits = pendingExits(state)
    const sentAt = Date.now()
    try {
      const result = await handInAction(v.attemptId, { deviceId: deviceIdRef.current, answers: allAnswers(state), exits })
      const receivedAt = Date.now()
      if (result.ok) {
        commit(mergeServerCopy(acknowledge(localRef.current, result.data.acceptedRevs, exits.map((e) => e.exitId)), result.data.saved))
        applyView(result.data, sentAt, receivedAt)
        setStatus('saved')
        schedule(retryDelayMs(0))
        return true
      }
      if (isOpenElsewhere(result)) stop('open_elsewhere')
      else setHandInProblem('failed')
      return false
    } catch {
      setHandInProblem('offline')
      setStatus('offline')
      return false
    } finally {
      setHandingIn(false)
    }
  }

  async function onBegin() {
    if (device?.canFullscreen) {
      try {
        await document.documentElement.requestFullscreen()
        setFullscreenMode(true)
      } catch {
        // Refused (e.g. a browser setting): go on without full screen; hidden and blur still count.
      }
    }
    setBegun(true)
  }

  async function onContinueFromWarning() {
    if (fullscreenMode && !document.fullscreenElement) {
      resumingRef.current = warning?.awayMs === null
      try {
        await document.documentElement.requestFullscreen()
      } catch {
        resumingRef.current = false
        return
      }
    }
    setWarning(null)
  }

  // ------------------------------------------------------------------------------------------
  // Screens
  // ------------------------------------------------------------------------------------------

  if (fatal === 'open_elsewhere') return <NoticeScreen kind="open_elsewhere" onRetry={() => void open()} />
  if (fatal === 'open_failed') return <NoticeScreen kind="open_failed" onRetry={() => void open()} />
  if (fatal === 'not_your_course') return <NoticeScreen kind="not_your_course" />
  if (!view) return <LoadingScreen />

  const answered = answeredCount(local)
  const screen = screenFor({
    stage: view.stage,
    attemptId: view.attemptId,
    verdict,
    needsBegin,
    hasWarning: warning !== null,
    timeUp,
  })

  switch (screen) {
    case 'waiting':
      return <WaitingScreen info={view.info} status={status} />
    case 'begin':
      return <BeginScreen title={view.info.title} onBegin={() => void onBegin()} />
    case 'warning':
      return (
        <WarningScreen
          exitNumber={warning!.exitNumber}
          rule={rule}
          awayMs={warning!.awayMs}
          liveAwayMs={nowMs - warning!.leftAtEpochMs}
          msLeft={msLeft}
          status={status}
          fullscreen={fullscreenMode && !isFullscreen}
          onContinue={() => void onContinueFromWarning()}
        />
      )
    case 'question':
      return view.paper && view.paper.length > 0 ? (
        <QuestionScreen
          paper={view.paper}
          index={Math.min(index, view.paper.length - 1)}
          onIndex={setIndex}
          answers={local.answers}
          answered={answered}
          msLeft={msLeft}
          timeUp={timeUp}
          status={status}
          onAnswer={onAnswer}
          onHandIn={onHandIn}
          handingIn={handingIn}
          handInProblem={handInProblem}
        />
      ) : (
        <LoadingScreen />
      )
    case 'ended': {
      const reason =
        verdict === 'end_exits' ? 'exits' : verdict === 'end_absence' ? 'absence' : endReason(rule, view.exitsSoFar)
      return (
        <EndedScreen
          reason={reason}
          exits={Math.max(view.exitsSoFar, exitCount(view.exitsSoFar, local.exits))}
          maxAbsenceSeconds={rule.maxAbsenceSeconds}
          answered={answered}
          hasShort={view.info.hasShort}
          status={status}
        />
      )
    }
    case 'result':
      return <ResultScreen info={view.info} result={view.result} />
    case 'closed':
      return <NoticeScreen kind="closed" />
  }
}
