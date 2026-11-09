'use client'

import { Maximize2, Square } from 'lucide-react'
import { CopyButton } from '@/components/copy-button'
import { useLocale, useTranslations } from 'next-intl'
import { useRouter } from 'next/navigation'
import { useEffect, useRef, useState, useSyncExternalStore, useTransition } from 'react'
import { ErrorCodeMessage } from '@/components/action-error'
import { Button } from '@/components/ui/button'
import { FieldError } from '@/components/ui/field'
import { DEFAULT_LOCALE, isLocale } from '@/i18n/locale'
import type { ActionResult } from '@/lib/action-result'
import { LIVE_POLL_MS } from '@/server/attendance/rules'
import { closeWindowAction, getLiveWindowAction, type LiveWindowView } from './attendance-actions'
import { AttendanceError } from './attendance-controls'
import { formatSessionDate } from './attendance-format'

type Snapshot = { view: LiveWindowView; receivedAt: number }

const subscribeNever = () => () => {}

/** Whether this browser lets the page go full screen (false on iPhone Safari, in some iframes). */
function useFullscreenEnabled(): boolean {
  return useSyncExternalStore(
    subscribeNever,
    () => document.fullscreenEnabled === true,
    () => false, // server render: no button until the browser says it can
  )
}

const COARSE_POINTER = '(pointer: coarse)'

/** A touch screen as the main pointer: there is no Esc key to mention. */
function useTouchScreen(): boolean {
  return useSyncExternalStore(
    (onChange) => {
      const query = window.matchMedia(COARSE_POINTER)
      query.addEventListener('change', onChange)
      return () => query.removeEventListener('change', onChange)
    },
    () => window.matchMedia(COARSE_POINTER).matches,
    () => false,
  )
}

type PollProblem = { kind: 'network' } | { kind: 'error'; result: Extract<ActionResult<unknown>, { ok: false }> }

/**
 * The projector view of an open check-in window: the current code (huge), a countdown to the
 * next one, and how many students have checked in. Polls every LIVE_POLL_MS; between polls the
 * countdown runs on the local clock and resyncs on each answer. When the window reports closed
 * (lecturer closed it, or 15 minutes passed) polling stops and the page refreshes. "Copy check-in
 * link" (never shown full screen, so it is not projected) lets students check in without the code.
 */
export function LiveWindow({
  initial,
  link,
  timeZone,
}: {
  initial: LiveWindowView
  /** The signed check-in link for this window (no code in it), absolute; null if it could not be made. */
  link: string | null
  timeZone: string
}) {
  const t = useTranslations('attendance.lecturer')
  const locale = useLocale()
  const router = useRouter()
  const panel = useRef<HTMLElement>(null)
  const [snapshot, setSnapshot] = useState<Snapshot>(() => ({ view: initial, receivedAt: Date.now() }))
  const [now, setNow] = useState(() => Date.now())
  const [problem, setProblem] = useState<PollProblem | null>(null)
  const [fullscreen, setFullscreen] = useState(false)
  const canFullscreen = useFullscreenEnabled()
  const touchScreen = useTouchScreen()
  const [closeState, setCloseState] = useState<ActionResult<unknown> | null>(null)
  const [closing, startClosing] = useTransition()
  const { view } = snapshot
  const windowId = view.windowId
  const open = view.open

  // Poll while open. Each answer is applied only if it is the latest request (stale guard).
  useEffect(() => {
    if (!open) return
    let cancelled = false
    let request = 0
    let timer: ReturnType<typeof setTimeout> | undefined

    async function poll() {
      const mine = ++request
      try {
        const result = await getLiveWindowAction(windowId)
        if (cancelled || mine !== request) return
        if (result.ok) {
          setSnapshot({ view: result.data, receivedAt: Date.now() })
          setProblem(null)
          if (!result.data.open) return // closed: the effect below refreshes the page
        } else {
          setProblem({ kind: 'error', result })
          return // a service error (e.g. session deleted) won't fix itself
        }
      } catch {
        if (cancelled || mine !== request) return
        setProblem({ kind: 'network' })
      }
      timer = setTimeout(poll, LIVE_POLL_MS)
    }

    timer = setTimeout(poll, LIVE_POLL_MS)
    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [windowId, open])

  // Once the window reports closed, reload the server view (buttons, statuses).
  useEffect(() => {
    if (!open) router.refresh()
  }, [open, router])

  // A local one-second tick for the countdown.
  useEffect(() => {
    if (!open) return
    const id = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(id)
  }, [open])

  useEffect(() => {
    const onChange = () => setFullscreen(document.fullscreenElement === panel.current)
    document.addEventListener('fullscreenchange', onChange)
    return () => document.removeEventListener('fullscreenchange', onChange)
  }, [])

  const secondsLeft =
    view.codeExpiresInSeconds === null
      ? null
      : Math.max(0, view.codeExpiresInSeconds - Math.floor((now - snapshot.receivedAt) / 1000))
  const closesAt = formatSessionDate(new Date(view.closesAt), isLocale(locale) ? locale : DEFAULT_LOCALE, timeZone, 'time')

  function present() {
    panel.current?.requestFullscreen?.().catch(() => {
      // Fullscreen refused (e.g. iframe or browser policy): the panel stays as it is.
    })
  }

  function close() {
    startClosing(async () => {
      const result = await closeWindowAction(windowId)
      setCloseState(result)
      if (result.ok) {
        if (document.fullscreenElement) await document.exitFullscreen().catch(() => {})
        setSnapshot((s) => ({ ...s, view: { ...s.view, open: false, code: null, codeExpiresInSeconds: null } }))
      }
    })
  }

  return (
    <section
      ref={panel}
      aria-labelledby="live-window-title"
      className="flex flex-col items-center gap-6 rounded-3xl border bg-card p-5 text-center sm:p-8 [&:fullscreen]:justify-center [&:fullscreen]:rounded-none [&:fullscreen]:border-0 [&:fullscreen]:bg-background"
    >
      <h2
        id="live-window-title"
        className="font-mono text-[13px] font-semibold tracking-[0.1em] text-muted-foreground uppercase"
      >
        {t(`kind.${view.kind}`)} · {t('live.codeLabel')}
      </h2>

      <p
        data-testid="attendance-code"
        aria-live="polite"
        aria-atomic="true"
        className={
          fullscreen
            ? 'font-display text-[min(22vw,40vh)] leading-none tracking-[0.12em]'
            : 'font-display text-[min(18vw,9rem)] leading-none tracking-[0.12em]'
        }
      >
        {/* No code (closing): a placeholder kept out of the live region's announcements. */}
        {view.code ?? <span aria-hidden="true">——————</span>}
      </p>

      <div className="flex flex-col items-center gap-1">
        {secondsLeft !== null && (
          <p className="font-mono text-sm tracking-[0.04em] text-muted-foreground">
            {t('live.nextCode', { seconds: secondsLeft })}
          </p>
        )}
        <p
          data-testid="attendance-count"
          aria-live="polite"
          className={fullscreen ? 'font-display text-6xl tracking-[0.02em]' : 'font-display text-4xl tracking-[0.02em]'}
        >
          {t('live.count', { count: view.checkedInCount, total: view.rosterSize })}
        </p>
        <p className="text-sm text-muted-foreground">{t('live.closesAt', { time: closesAt })}</p>
      </div>

      {problem && (
        <FieldError>
          {problem.kind === 'network' ? t('live.reconnecting') : <ErrorCodeMessage code={problem.result.code} />}
        </FieldError>
      )}

      {fullscreen ? (
        !touchScreen && (
          <p className="font-mono text-xs tracking-[0.1em] text-muted-foreground uppercase">{t('live.exitHint')}</p>
        )
      ) : (
        <div className="flex flex-col items-center gap-4">
          {link && open && (
            <div className="flex max-w-md flex-col items-center gap-2">
              <CopyButton value={link} label={t('live.copyLinkLabel')} text={t('live.copyLink')} variant="outline" />
              <p className="text-sm text-muted-foreground">{t('live.linkHint')}</p>
            </div>
          )}
          <div className="flex flex-wrap justify-center gap-2.5">
            {canFullscreen && (
              <Button type="button" variant="outline" onClick={present}>
                <Maximize2 aria-hidden="true" data-icon="inline-start" />
                {t('live.present')}
              </Button>
            )}
            <Button type="button" variant="destructive" disabled={closing || !open} onClick={close}>
              <Square aria-hidden="true" data-icon="inline-start" />
              {closing ? t('live.closing') : t('live.close')}
            </Button>
          </div>
        </div>
      )}
      <AttendanceError state={closeState} />
    </section>
  )
}
