'use client'

import { ExternalLink } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { useEffect, useId, useRef, useState } from 'react'
import {
  connectWhatsAppAction,
  disconnectWhatsAppAction,
  getWhatsAppSettingsAction,
  setWhatsAppPreferenceAction,
} from '@/app/actions/whatsapp'
import { ErrorCodeMessage } from '@/components/action-error'
import { Button } from '@/components/ui/button'
import type { ActionResult } from '@/lib/action-result'
import { cn } from '@/lib/utils'
import { POLL_MS, pollOutcome } from '@/lib/whatsapp-connect'
import type { WhatsAppPrefs } from '@/server/whatsapp/link'

const STUDENT_KEYS = ['checkin', 'tests', 'results', 'assignments'] as const satisfies readonly (keyof WhatsAppPrefs)[]
const LECTURER_KEYS = ['classSoon'] as const satisfies readonly (keyof WhatsAppPrefs)[]

/** An error result, or 'unexpected' for a network failure or an unexpected server error. */
type Failure = ActionResult<unknown> | 'unexpected' | null

/**
 * Settings → WhatsApp: connect (opens WhatsApp with the code ready to send, then waits for the
 * message to arrive), disconnect, and one switch per alert for the account's roles. The page does
 * not render this at all when WhatsApp isn't set up.
 */
export function WhatsAppSettings({
  maskedPhone: initialPhone,
  prefs: initialPrefs,
  roles,
}: {
  maskedPhone: string | null
  prefs: WhatsAppPrefs
  roles: { student: boolean; lecturer: boolean }
}) {
  const t = useTranslations('settings.whatsapp')
  const tCommon = useTranslations('common')
  const [phone, setPhone] = useState(initialPhone)
  const [prefs, setPrefs] = useState(initialPrefs)
  // The wa.me link while waiting for the message to arrive.
  const [waiting, setWaiting] = useState<string | null>(null)
  const [expired, setExpired] = useState(false)
  const [pending, setPending] = useState<'connect' | 'disconnect' | null>(null)
  const [failure, setFailure] = useState<Failure>(null)

  // While waiting: ask every few seconds, and at once when the tab comes back into view (the user
  // returns from WhatsApp). The answer always counts first; "expired" only when the 15 minutes
  // are over and the server still shows no number. Stops when connected, expired or unmounted.
  useEffect(() => {
    if (!waiting) return
    let alive = true
    let busy = false
    const startedAt = Date.now()
    const stop = () => {
      clearInterval(timer)
      document.removeEventListener('visibilitychange', onVisible)
    }
    async function check() {
      if (busy || !alive) return
      busy = true
      try {
        const result = await getWhatsAppSettingsAction()
        if (!alive || !result.ok) return
        const outcome = pollOutcome({ phone: result.data.maskedPhone, startedAt, now: Date.now() })
        if (outcome === 'waiting') return
        stop()
        setWaiting(null)
        if (outcome === 'connected') {
          setPhone(result.data.maskedPhone)
          setPrefs(result.data.prefs)
        } else setExpired(true)
      } catch {
        // A failed check is tried again on the next tick.
      } finally {
        busy = false
      }
    }
    function onVisible() {
      if (document.visibilityState === 'visible') void check()
    }
    const timer = setInterval(() => void check(), POLL_MS)
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      alive = false
      stop()
    }
  }, [waiting])

  async function connect() {
    setPending('connect')
    setFailure(null)
    setExpired(false)
    try {
      const result = await connectWhatsAppAction()
      if (!result.ok) {
        setFailure(result)
        return
      }
      // A new tab, so this page stays here; on a phone the link opens the WhatsApp app. If the
      // browser blocks the tab (this runs after a server round trip), go there in this tab: that
      // is never blocked, and the settings page is fine to come back to.
      const tab = window.open(result.data.url, '_blank')
      if (tab) tab.opener = null
      else window.location.assign(result.data.url)
      setWaiting(result.data.url)
    } catch {
      setFailure('unexpected')
    } finally {
      setPending(null)
    }
  }

  async function disconnect() {
    setPending('disconnect')
    setFailure(null)
    try {
      const result = await disconnectWhatsAppAction()
      if (!result.ok) setFailure(result)
      else {
        setPhone(null)
        setWaiting(null)
      }
    } catch {
      setFailure('unexpected')
    } finally {
      setPending(null)
    }
  }

  const keys = [...(roles.student ? STUDENT_KEYS : []), ...(roles.lecturer ? LECTURER_KEYS : [])]

  return (
    <div className="flex flex-col gap-5">
      {phone ? (
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between sm:gap-5">
          <p className="min-w-0 text-[15px] font-medium">{t('connected', { phone })}</p>
          <div className="shrink-0">
            <Button
              type="button"
              variant="outline"
              onClick={disconnect}
              pending={pending === 'disconnect'}
              disabled={pending !== null}
            >
              {pending === 'disconnect' ? t('disconnecting') : t('disconnect')}
            </Button>
          </div>
        </div>
      ) : (
        <div className="flex flex-col items-start gap-3">
          <Button
            type="button"
            onClick={connect}
            pending={pending === 'connect'}
            disabled={pending !== null || waiting !== null}
          >
            {pending === 'connect' ? t('connecting') : t('connect')}
          </Button>
          {waiting && (
            <div role="status" className="flex flex-col items-start gap-2">
              <p className="max-w-prose text-sm text-muted-foreground">{t('waiting')}</p>
              {/* If the browser blocked the new tab, this opens WhatsApp. */}
              <a
                href={waiting}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 rounded-sm text-sm font-medium text-primary outline-none hover:underline focus-visible:ring-3 focus-visible:ring-ring/50"
              >
                <ExternalLink aria-hidden="true" className="size-4" />
                {t('openAgain')}
              </a>
            </div>
          )}
          {expired && (
            <p role="status" className="max-w-prose text-sm text-muted-foreground">
              {t('expired')}
            </p>
          )}
        </div>
      )}

      {failure && (
        <p role="alert" className="text-sm text-destructive">
          {failure === 'unexpected' ? tCommon('genericError') : failure.ok ? null : <ErrorCodeMessage code={failure.code} />}
        </p>
      )}

      {phone && keys.length > 0 && (
        <div role="group" aria-label={t('alertsTitle')} className="flex flex-col divide-y border-t">
          {keys.map((key) => (
            <PreferenceSwitch key={`${phone}-${key}`} prefKey={key} initial={prefs[key]} />
          ))}
        </div>
      )}

      {phone && <p className="text-[13px] text-muted-foreground">{t('stopHint')}</p>}
    </div>
  )
}

/** One alert type. Saves on change; the switch flips at once and flips back on an error. */
function PreferenceSwitch({ prefKey, initial }: { prefKey: keyof WhatsAppPrefs; initial: boolean }) {
  const t = useTranslations('settings.whatsapp')
  const tCommon = useTranslations('common')
  const [checked, setChecked] = useState(initial)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<Failure>(null)
  // Clicks while a save is running are ignored, without a re-render to read the state from.
  const saving = useRef(false)
  const titleId = useId()

  async function change(next: boolean) {
    if (saving.current) return
    saving.current = true
    const previous = checked
    setChecked(next)
    setPending(true)
    setError(null)
    try {
      const result = await setWhatsAppPreferenceAction(prefKey, next)
      if (!result.ok) {
        setChecked(previous)
        setError(result)
      }
    } catch {
      setChecked(previous)
      setError('unexpected')
    } finally {
      saving.current = false
      setPending(false)
    }
  }

  return (
    <div className="flex flex-col gap-1 py-1.5">
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-labelledby={titleId}
        aria-disabled={pending}
        onClick={() => change(!checked)}
        className="flex min-h-11 items-center justify-between gap-3 rounded-xl text-left outline-none focus-visible:ring-3 focus-visible:ring-ring/50 aria-disabled:opacity-70"
      >
        <span id={titleId} className="font-medium">
          {t(`prefs.${prefKey}`)}
        </span>
        <span
          aria-hidden="true"
          className={cn(
            'inline-flex h-6 w-10 shrink-0 items-center rounded-full p-0.5 transition-colors',
            checked ? 'bg-primary' : 'bg-input',
          )}
        >
          <span
            className={cn(
              'size-5 rounded-full bg-background shadow-sm transition-transform motion-reduce:transition-none',
              checked ? 'translate-x-4' : 'translate-x-0',
            )}
          />
        </span>
      </button>
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error === 'unexpected' ? tCommon('genericError') : error.ok ? null : <ErrorCodeMessage code={error.code} />}
        </p>
      )}
    </div>
  )
}
