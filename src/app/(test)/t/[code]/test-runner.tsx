'use client'

import { useCallback, useEffect, useEffectEvent, useRef, useState, useSyncExternalStore } from 'react'
import type { ActionResult } from '@/lib/action-result'
import { postJson } from './attempt-client'
import {
  createLeaveTracker,
  FOCUS_QUIET_MS,
  type LeaveEvent,
  type LeaveSignal,
  type LeaveTracker,
  type OpenExit,
} from './leave-tracker'
import {
  acknowledge,
  answeredCount,
  attemptKey,
  clearLocalAttempt,
  dropExit,
  emptyAttempt,
  hasLeftQueued,
  loadLocalAttempt,
  mergeServerCopy,
  pendingAnswers,
  pendingExits,
  recordAnswer,
  recordLeaveEvent,
  saveLocalAttempt,
  type LocalAttempt,
} from './answer-store'
import { getDeviceId, randomUuid } from './device-id'
import { EndedScreen } from './ended-screen'
import { BeginScreen, LoadingScreen, NoticeScreen } from './notice-screen'
import { QuestionScreen, type HandInProblem } from './question-screen'
import { ResultScreen } from './result-screen'
import {
  allAnswers,
  armsLeaving,
  clearsLocalCopy,
  endReason,
  exitCount,
  keepSyncing,
  localVerdict,
  navigationFor,
  pickClockSample,
  resolveOpenExit,
  retryDelayMs,
  screenFor,
  settleFinalAnswers,
  syncDueAt,
  tracksLeaving,
  type ClockSample,
  type NavInfo,
} from './runner-logic'
import type { SyncStatus } from './screen-parts'
import { clockOffsetMs, msLeft as msLeftUntil } from './server-clock'
import type { AttemptViewDto } from './view-dto'
import { WaitingScreen } from './waiting-screen'
import { createWakeLockKeeper } from './wake-lock'
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

/** How this page was reached and when it started (see navigationFor). */
function readNavigation(mountedAtMs: number): NavInfo {
  const [entry] = performance.getEntriesByType('navigation') as PerformanceNavigationTiming[]
  return navigationFor({
    entry: entry ? { type: entry.type, url: entry.name } : null,
    timeOriginMs: performance.timeOrigin,
    currentPath: window.location.pathname,
    mountedAtMs,
  })
}

/** Keeps the paper (and saved answers) the device holds when a lean sync leaves them out. */
function withKeptPaper(dto: AttemptViewDto, previous: AttemptViewDto | null): AttemptViewDto {
  if (dto.paper !== undefined && dto.saved !== undefined) return dto
  return { ...dto, paper: dto.paper ?? previous?.paper ?? null, saved: dto.saved ?? previous?.saved ?? [] }
}

/** The device holds no paper and the attempt may still show one: the next sync asks for it. */
function needsPaper(view: AttemptViewDto): boolean {
  return !view.paper && (view.stage === 'waiting' || view.stage === 'answering' || view.stage === 'ended_left')
}

/**
 * The student's side of a test. The server decides (stage, deadline, result); this keeps every
 * answer and leave report on the device first (localStorage, written synchronously), sends them
 * to the sync route (every STUDENT_SYNC_MS, soon after each answer, at once after each exit, on
 * `online` and on return), and judges leaving locally too so an ended student sees it offline.
 * Every request has a deadline (postJson): a failed or stalled request is never leaving, it only
 * changes the "saved on this device" line.
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
  /** When the pending timer fires (epoch ms), null when none is pending. */
  const dueAtRef = useRef<number | null>(null)
  const syncRef = useRef<() => Promise<void>>(async () => {})
  const inFlightRef = useRef(false)
  const againRef = useRef(false)
  const failuresRef = useRef(0)
  const stoppedRef = useRef(false)
  /** "Back to full screen" was pressed: the `back` it causes goes straight to the questions. */
  const resumingRef = useRef(false)
  /** Aborts the requests in flight when the runner goes away. */
  const abortRef = useRef<AbortController | null>(null)
  /** When the runner mounted (the page start when it was reached inside the app). */
  const mountedAtRef = useRef(0)
  /** The exit left open by the previous page (closed tab or reload), judged once by I1's rule. */
  const reopenedExitRef = useRef<string | null>(null)
  const trackerRef = useRef<LeaveTracker | null>(null)

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
    const next = withKeptPaper(dto, viewRef.current)
    viewRef.current = next
    setView(next)
  }, [])

  const stop = useCallback((reason: Fatal) => {
    stoppedRef.current = true
    if (timerRef.current) clearTimeout(timerRef.current)
    timerRef.current = null
    dueAtRef.current = null
    setFatal(reason)
  }, [])

  // ------------------------------------------------------------------------------------------
  // Talking to the server
  // ------------------------------------------------------------------------------------------

  /** Sets the one sync timer; `keepSooner` keeps a timer already due sooner (see syncDueAt). */
  const schedule = useCallback((delayMs: number, keepSooner = false) => {
    const now = Date.now()
    const dueAt = syncDueAt(dueAtRef.current, now, delayMs, keepSooner)
    if (timerRef.current) clearTimeout(timerRef.current)
    timerRef.current = null
    dueAtRef.current = null
    if (stoppedRef.current) return
    dueAtRef.current = dueAt
    timerRef.current = setTimeout(
      () => {
        timerRef.current = null
        dueAtRef.current = null
        void syncRef.current()
      },
      Math.max(0, dueAt - now),
    )
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
    const signal = abortRef.current?.signal
    const sentAt = Date.now()
    let ok = false
    try {
      const result = await postJson<AttemptViewDto>(
        `/api/tests/attempts/${encodeURIComponent(v.attemptId)}/sync`,
        { deviceId: deviceIdRef.current, answers, exits, withPaper: needsPaper(v) },
        { signal },
      )
      const receivedAt = Date.now()
      if (stoppedRef.current || signal?.aborted) return
      if (result === 'offline') {
        // No connection, cut, or no answer in time: everything stays queued on the device.
        failuresRef.current += 1
        setStatus('offline')
      } else if (result === 'failed') {
        failuresRef.current += 1
        setStatus('failed')
      } else if (result.ok) {
        ok = true
        failuresRef.current = 0
        // Exactly the reports sent: one id per report (a left and its back share an id). Answers
        // the server no longer takes (after the end or a hand-in) are final, not pending forever.
        const acknowledged = acknowledge(localRef.current, result.data.acceptedRevs, exits.map((e) => e.exitId))
        commit(settleFinalAnswers(acknowledged, result.data, answers))
        applyView(result.data, sentAt, receivedAt)
        setStatus(hasQueued(localRef.current) ? 'saving' : 'saved')
      } else if (isOpenElsewhere(result)) {
        stop('open_elsewhere')
        return
      } else if (result.code === 'FORBIDDEN') {
        stop('not_your_course')
        return
      } else {
        failuresRef.current += 1
        setStatus(result.code === 'UNAUTHENTICATED' ? 'signed_out' : 'failed')
      }
    } finally {
      inFlightRef.current = false
    }
    if (ok && againRef.current) {
      againRef.current = false
      schedule(0)
    } else {
      againRef.current = false
      // An answer changed during the request has a sooner timer: it is not pushed back.
      schedule(retryDelayMs(failuresRef.current), true)
    }
  }, [applyView, commit, schedule, stop])
  useEffect(() => {
    syncRef.current = sync
  }, [sync])

  const open = useCallback(async () => {
    stoppedRef.current = false
    const signal = abortRef.current?.signal
    const sentAt = Date.now()
    const result = await postJson<AttemptViewDto>('/api/tests/open', { code, deviceId: deviceIdRef.current }, { signal })
    const receivedAt = Date.now()
    // This runner went away meanwhile (a remount has its own request).
    if (signal?.aborted) return
    if (result === 'offline' || result === 'failed') {
      setFatal('open_failed')
      return
    }
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
      const stored = loadLocalAttempt(keyRef.current)
      reopenedExitRef.current = stored.openExit?.exitId ?? null
      commit(settleFinalAnswers(mergeServerCopy(stored, dto.saved ?? []), dto, []))
    }
    applyView(dto, sentAt, receivedAt)
    setStatus(hasQueued(localRef.current) ? 'saving' : 'saved')
    // Queued answers and leave reports (from before a reload) go out at once.
    schedule(hasQueued(localRef.current) ? 0 : retryDelayMs(0))
  }, [applyView, code, commit, schedule, userId])

  const onMount = useEffectEvent(() => {
    deviceIdRef.current = getDeviceId()
    mountedAtRef.current = Date.now()
    abortRef.current = new AbortController()
    void open()
  })

  useEffect(() => {
    // Starts the first request; state is only set once it answers.
    onMount()
    const tick = setInterval(() => setNowMs(Date.now()), 1000)
    return () => {
      clearInterval(tick)
      // Gone (e.g. Back to dashboard): no request in flight re-arms the timer after this.
      stoppedRef.current = true
      abortRef.current?.abort()
      if (timerRef.current) clearTimeout(timerRef.current)
      timerRef.current = null
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
  /** Leaving is watched only while answering: not before Start, after the end, a hand-in or an ending. */
  const tracking = view !== null && tracksLeaving({ stage: view.stage, verdict, timeUp, fatal: fatal !== null })
  const screen =
    view && fatal === null
      ? screenFor({ stage: view.stage, attemptId: view.attemptId, verdict, needsBegin, hasWarning: warning !== null, timeUp })
      : null
  /** On the questions: leaving counts from the first moment the student is present (C1). */
  const onQuestions = screen !== null && armsLeaving(screen)

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

  /**
   * The exit the previous page left open, judged once when tracking starts (I1): a same-tab reload
   * is dropped (or comes back at once), a closed tab counts up to the new page's start, and a page
   * opened hidden is left to the tracker, which judges it when the page shows.
   */
  const takeOpenExit = useEffectEvent((): OpenExit | null => {
    const openExit = localRef.current.openExit
    if (!openExit || openExit.exitId !== reopenedExitRef.current) return openExit
    reopenedExitRef.current = null
    const decision = resolveOpenExit({
      openExit,
      nav: readNavigation(mountedAtRef.current),
      visible: document.visibilityState === 'visible',
      leftQueued: hasLeftQueued(localRef.current, openExit.exitId),
    })
    if (decision.kind === 'wait') return openExit
    if (decision.kind === 'drop') commit(dropExit(localRef.current, openExit.exitId))
    else onLeaveEvent({ type: 'back', exitId: openExit.exitId, awayMs: decision.awayMs })
    return null
  })

  const armIfOnQuestions = useEffectEvent((tracker: LeaveTracker) => {
    if (onQuestions) tracker.arm()
  })

  useEffect(() => {
    if (!tracking || device === null) return
    const tracker = createLeaveTracker({
      countsFocus: device.laptop,
      countsFullscreen: fullscreenMode,
      now: Date.now,
      newId: randomUuid,
      openExit: takeOpenExit(),
      armed: false,
    })
    trackerRef.current = tracker
    const feed = (signal: LeaveSignal) => {
      const event = tracker.handle(signal)
      if (event) onLeaveEvent(event)
    }
    const visibility = (): LeaveSignal => (document.visibilityState === 'hidden' ? 'hidden' : 'visible')
    // After a full screen change, blur and focus are ignored for a moment (macOS fires them while
    // the window moves); the real focus is read once the moment has passed.
    let settleTimer: ReturnType<typeof setTimeout> | null = null
    const settleFocus = () => {
      if (!device.laptop) return
      if (settleTimer) clearTimeout(settleTimer)
      settleTimer = setTimeout(() => feed(document.hasFocus() ? 'focus' : 'blur'), FOCUS_QUIET_MS + 50)
    }
    // The state right now (a page opened hidden is judged when it shows). Focus is not read here:
    // a page often loads without focus (address bar, a link opened from another app), and counting
    // that as leaving would be unfair; only a real `blur` after this counts.
    feed(visibility())
    if (fullscreenMode) {
      feed(document.fullscreenElement ? 'fullscreen_enter' : 'fullscreen_exit')
      settleFocus()
    }
    armIfOnQuestions(tracker)

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
      if (!fullscreenMode) return
      feed(document.fullscreenElement ? 'fullscreen_enter' : 'fullscreen_exit')
      settleFocus()
    }
    document.addEventListener('visibilitychange', onVisibility)
    window.addEventListener('pageshow', onPageShow)
    window.addEventListener('pagehide', onHide)
    window.addEventListener('blur', onBlur)
    window.addEventListener('focus', onFocus)
    document.addEventListener('fullscreenchange', onFullscreen)
    return () => {
      if (settleTimer) clearTimeout(settleTimer)
      if (trackerRef.current === tracker) trackerRef.current = null
      document.removeEventListener('visibilitychange', onVisibility)
      window.removeEventListener('pageshow', onPageShow)
      window.removeEventListener('pagehide', onHide)
      window.removeEventListener('blur', onBlur)
      window.removeEventListener('focus', onFocus)
      document.removeEventListener('fullscreenchange', onFullscreen)
    }
  }, [tracking, device, fullscreenMode])

  // The questions show (first time, after Begin, after a let back in): leaving counts from the first
  // moment the student is present on them.
  useEffect(() => {
    if (onQuestions) trackerRef.current?.arm()
  }, [onQuestions])

  // Keep the screen on while answering (C2): a phone locking itself after 30 s of reading must not
  // count as leaving. The browser drops the lock whenever the page hides, so it is asked for again
  // on each return; a tap also asks (some browsers want one). Unsupported or refused: silent.
  useEffect(() => {
    if (!tracking) return
    const wakeLock = 'wakeLock' in navigator ? navigator.wakeLock : null
    const keeper = createWakeLockKeeper(wakeLock ? () => wakeLock.request('screen') : null)
    const refresh = () => void keeper.refresh(document.visibilityState === 'visible')
    refresh()
    document.addEventListener('visibilitychange', refresh)
    window.addEventListener('pageshow', refresh)
    window.addEventListener('pointerdown', refresh, { passive: true })
    return () => {
      document.removeEventListener('visibilitychange', refresh)
      window.removeEventListener('pageshow', refresh)
      window.removeEventListener('pointerdown', refresh)
      keeper.release()
    }
  }, [tracking])

  // Out of answering (ended, handed in, time up, open elsewhere): an exit still open no longer
  // counts, and full screen is released. Otherwise a stale exit would be judged if the lecturer lets
  // the student back in. Begin shows again then, so full screen is re-entered with a click before
  // leaving it counts (a tracker that counted it at once would log a false exit).
  const onStopTracking = useEffectEvent(() => {
    if (localRef.current.openExit) commit({ ...localRef.current, openExit: null })
    // An ending while "Back to full screen" was pending: the next return after a let back in warns.
    resumingRef.current = false
    setWarning(null)
    setFullscreenMode(false)
    setBegun(false)
    if (document.fullscreenElement) void document.exitFullscreen().catch(() => {})
  })
  useEffect(() => {
    if (view !== null && !tracking) onStopTracking()
  }, [view, tracking])

  // Handed in, a result shown, or nothing more to send: final on the server, nothing left to keep
  // on the device.
  useEffect(() => {
    if (!view || !keyRef.current) return
    if (!clearsLocalCopy({ ...view, hasShort: view.info.hasShort }, hasQueued(local))) return
    clearLocalAttempt(keyRef.current)
    keyRef.current = null
  }, [view, local])

  // A new screen (not the questions, which focus their prompt, nor Begin and the warning, which
  // focus their button): focus its title so keyboard and screen reader users start there.
  const previousScreenRef = useRef<typeof screen>(null)
  useEffect(() => {
    const previous = previousScreenRef.current
    previousScreenRef.current = screen
    if (previous === null || previous === screen || screen === null) return
    if (screen === 'question' || screen === 'begin' || screen === 'warning') return
    const heading = document.querySelector<HTMLElement>('main h1')
    if (!heading) return
    heading.setAttribute('tabindex', '-1')
    heading.focus()
  }, [screen])

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
      const result = await postJson<AttemptViewDto>(
        `/api/tests/attempts/${encodeURIComponent(v.attemptId)}/hand-in`,
        { deviceId: deviceIdRef.current, answers: allAnswers(state), exits },
        { signal: abortRef.current?.signal },
      )
      const receivedAt = Date.now()
      if (result === 'offline') {
        // No answer in time either: the answers stay on the device and the student can try again.
        setHandInProblem('offline')
        setStatus('offline')
        return false
      }
      if (result === 'failed') {
        setHandInProblem('failed')
        return false
      }
      if (result.ok) {
        const merged = mergeServerCopy(
          acknowledge(localRef.current, result.data.acceptedRevs, exits.map((e) => e.exitId)),
          result.data.saved ?? [],
        )
        commit(settleFinalAnswers(merged, result.data, allAnswers(state)))
        applyView(result.data, sentAt, receivedAt)
        setStatus('saved')
        schedule(retryDelayMs(0))
        return true
      }
      if (isOpenElsewhere(result)) stop('open_elsewhere')
      else setHandInProblem('failed')
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
  if (!view || screen === null) return <LoadingScreen />

  const answered = answeredCount(local)

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
          onHandInOpen={() => setHandInProblem(null)}
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
