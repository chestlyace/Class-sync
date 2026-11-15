'use client'

import { Bell, BellOff, Download, Send, Share, SquarePlus } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { useRouter } from 'next/navigation'
import { useEffect, useId, useState } from 'react'
import {
  isMyDeviceAction,
  removeDeviceAction,
  sendTestPushAction,
  setClassRemindersAction,
  subscribePushAction,
  unsubscribePushAction,
} from '@/app/actions/push'
import { ErrorCodeMessage } from '@/components/action-error'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import type { ActionResult } from '@/lib/action-result'
import {
  onInstallPromptChange,
  readDeviceState,
  rememberInstallPrompt,
  storedInstallPrompt,
  turnOffPush,
  turnOnPush,
  type DeviceState,
} from '@/lib/push-client'

/** A device with notifications on, with its date already formatted by the page. */
export type DeviceRow = { id: string; label: string; added: string }

/**
 * Settings → Notifications and app: this browser's switch, a test notification, the account's
 * devices and installing the app (and, for students, the class reminder switch). The browser state is read after mount (nothing on the server).
 */
export function NotificationsSettings({
  devices,
  classReminders,
}: {
  devices: DeviceRow[]
  /** The student's class reminder setting; null for lecturers, who don't get the switch. */
  classReminders: boolean | null
}) {
  const t = useTranslations('settings.notifications')
  const router = useRouter()
  const [device, setDevice] = useState<DeviceState | null>(null)
  const [canInstall, setCanInstall] = useState(false)
  const [pending, setPending] = useState<'on' | 'off' | null>(null)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    let alive = true
    void readDeviceState(isMyDeviceAction).then((state) => {
      if (alive) setDevice(state)
    })
    const syncInstall = () => setCanInstall(storedInstallPrompt() !== null)
    const stop = onInstallPromptChange(syncInstall)
    queueMicrotask(syncInstall)
    return () => {
      alive = false
      stop()
    }
  }, [])

  async function turnOn() {
    setPending('on')
    setFailed(false)
    try {
      const result = await turnOnPush(subscribePushAction)
      setDevice(await readDeviceState(isMyDeviceAction))
      if (result === 'failed') setFailed(true)
      router.refresh()
    } finally {
      setPending(null)
    }
  }

  async function turnOff() {
    setPending('off')
    setFailed(false)
    try {
      await turnOffPush(unsubscribePushAction)
      setDevice(await readDeviceState(isMyDeviceAction))
      router.refresh()
    } finally {
      setPending(null)
    }
  }

  /** After a device row is removed: if it was this browser, the switch must read "off" now. */
  async function refreshDevice() {
    setDevice(await readDeviceState(isMyDeviceAction))
  }

  async function install() {
    const prompt = storedInstallPrompt()
    if (!prompt) return
    const shown = prompt.prompt()
    rememberInstallPrompt(null)
    try {
      await shown
      await prompt.userChoice
    } catch {
      // The browser refused to show it.
    }
    setDevice(await readDeviceState(isMyDeviceAction))
  }

  const on = device !== null && device.subscribed && device.permission === 'granted'
  const blocked = device?.support === 'supported' && device.permission === 'denied'

  return (
    <div className="flex flex-col divide-y">
      <div className="flex flex-col gap-4 pb-6" role="region" aria-labelledby="notifications-device">
        <h3 id="notifications-device" className="font-semibold">
          {t('thisDevice')}
        </h3>
        {device === null ? (
          <p className="text-sm text-muted-foreground">{t('checking')}</p>
        ) : device.support === 'unavailable' ? (
          <StatusLine icon={<BellOff />} text={t('unavailable')} />
        ) : device.support === 'unsupported' ? (
          <StatusLine icon={<BellOff />} text={t('unsupported')} />
        ) : device.support === 'needs-install' ? (
          <StatusLine icon={<BellOff />} text={t('needsInstall')} />
        ) : (
          <>
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between sm:gap-5">
              <StatusLine icon={on ? <Bell /> : <BellOff />} text={on ? t('on') : t('off')} />
              {!blocked && (
                <div className="shrink-0">
                  {on ? (
                    <Button type="button" variant="outline" onClick={turnOff} disabled={pending !== null}>
                      {pending === 'off' ? t('turningOff') : t('turnOff')}
                    </Button>
                  ) : (
                    <Button type="button" onClick={turnOn} disabled={pending !== null}>
                      {pending === 'on' ? t('turningOn') : t('turnOn')}
                    </Button>
                  )}
                </div>
              )}
            </div>
            {blocked && <p className="max-w-prose text-sm text-muted-foreground">{t('blocked')}</p>}
            {failed && (
              <p role="alert" className="text-sm text-destructive">
                {t('failed')}
              </p>
            )}
          </>
        )}
        {devices.length > 0 && <TestNotification />}
      </div>

      {classReminders !== null && <ClassRemindersSwitch initial={classReminders} />}

      <div className="flex flex-col gap-3 py-6" role="region" aria-labelledby="notifications-devices">
        <h3 id="notifications-devices" className="font-semibold">
          {t('devicesTitle')}
        </h3>
        {devices.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t('devicesEmpty')}</p>
        ) : (
          <ul className="flex flex-col divide-y border-t">
            {devices.map((row) => (
              <DeviceItem key={row.id} row={row} onRemoved={refreshDevice} />
            ))}
          </ul>
        )}
      </div>

      <div className="flex flex-col gap-3 pt-6" role="region" aria-labelledby="notifications-install">
        <h3 id="notifications-install" className="font-semibold">
          {t('install.title')}
        </h3>
        {device?.installed ? (
          <p className="text-sm text-muted-foreground">{t('install.installed')}</p>
        ) : canInstall ? (
          <div>
            <Button type="button" variant="outline" onClick={install}>
              <Download aria-hidden="true" data-icon="inline-start" />
              {t('install.button')}
            </Button>
          </div>
        ) : device?.ios ? (
          <ol className="flex flex-col gap-2 text-sm">
            <li className="flex items-center gap-2.5">
              <Share aria-hidden="true" className="size-4 shrink-0 text-primary" />
              {t('install.iosStep1')}
            </li>
            <li className="flex items-center gap-2.5">
              <SquarePlus aria-hidden="true" className="size-4 shrink-0 text-primary" />
              {t('install.iosStep2')}
            </li>
          </ol>
        ) : (
          <p className="text-sm text-muted-foreground">{t('install.hint')}</p>
        )}
      </div>
    </div>
  )
}

/** Students: the 15-minute class reminder. Saves on change; the switch flips at once and flips back on an error. */
function ClassRemindersSwitch({ initial }: { initial: boolean }) {
  const t = useTranslations('settings.notifications.classReminders')
  const tCommon = useTranslations('common')
  const [checked, setChecked] = useState(initial)
  const [pending, setPending] = useState(false)
  // An error result, or 'unexpected' for a network failure or an unexpected server error.
  const [error, setError] = useState<ActionResult<null> | 'unexpected' | null>(null)
  const titleId = useId()
  const hintId = useId()

  async function change(next: boolean) {
    // While saving the switch stays focusable (aria-disabled, not disabled) and ignores clicks.
    if (pending) return
    const previous = checked
    setChecked(next)
    setPending(true)
    setError(null)
    try {
      const result = await setClassRemindersAction(next)
      if (!result.ok) {
        setChecked(previous)
        setError(result)
      }
    } catch {
      setChecked(previous)
      setError('unexpected')
    } finally {
      setPending(false)
    }
  }

  return (
    <div className="flex flex-col gap-2 py-6">
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-labelledby={titleId}
        aria-describedby={hintId}
        aria-disabled={pending}
        onClick={() => change(!checked)}
        className="flex min-h-11 items-start gap-3 rounded-xl text-left outline-none focus-visible:ring-3 focus-visible:ring-ring/50 aria-disabled:opacity-70"
      >
        <span
          aria-hidden="true"
          className={cn(
            'mt-0.5 inline-flex h-6 w-10 shrink-0 items-center rounded-full p-0.5 transition-colors',
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
        <span className="flex flex-col gap-0.5">
          <span id={titleId} className="font-semibold">
            {t('title')}
          </span>
          <span id={hintId} className="text-sm text-muted-foreground">
            {t('hint')}
          </span>
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

function StatusLine({ icon, text }: { icon: React.ReactElement; text: string }) {
  return (
    <p className="flex min-w-0 items-start gap-2.5 text-[15px]">
      <span aria-hidden="true" className="mt-0.5 shrink-0 text-muted-foreground [&_svg]:size-5">
        {icon}
      </span>
      <span className="min-w-0">{text}</span>
    </p>
  )
}

function TestNotification() {
  const t = useTranslations('settings.notifications')
  const tCommon = useTranslations('common')
  const [pending, setPending] = useState(false)
  const [result, setResult] = useState<ActionResult<{ sent: number }> | null>(null)
  // A network failure or an unexpected server error (not an AppError result).
  const [unexpected, setUnexpected] = useState(false)

  async function send() {
    setPending(true)
    setUnexpected(false)
    try {
      setResult(await sendTestPushAction())
    } catch {
      setResult(null)
      setUnexpected(true)
    } finally {
      setPending(false)
    }
  }

  let message: React.ReactNode = null
  if (unexpected) message = tCommon('genericError')
  else if (result?.ok) message = result.data.sent > 0 ? t('testSent') : t('testNone')
  else if (result && result.code === 'CONFLICT' && result.details?.reason === 'rate_limited') {
    const seconds = Number(result.details.retryAfter) || 3600
    message = t('testLimited', { minutes: Math.max(1, Math.ceil(seconds / 60)) })
  } else if (result) message = <ErrorCodeMessage code={result.code} />

  return (
    <div className="flex flex-col items-start gap-2">
      <Button type="button" variant="outline" size="sm" onClick={send} disabled={pending}>
        <Send aria-hidden="true" data-icon="inline-start" />
        {pending ? t('testSending') : t('test')}
      </Button>
      {message && (
        <p role="status" className="text-sm text-muted-foreground">
          {message}
        </p>
      )}
    </div>
  )
}

function DeviceItem({ row, onRemoved }: { row: DeviceRow; onRemoved: () => Promise<void> }) {
  const t = useTranslations('settings.notifications')
  const [pending, setPending] = useState(false)
  const tCommon = useTranslations('common')
  // An error result, or 'unexpected' for a network failure or an unexpected server error.
  const [error, setError] = useState<ActionResult<null> | 'unexpected' | null>(null)
  // Stored as "Browser on OS" (fixed English names): only the joining word is translated.
  const [browser, os] = row.label.split(' on ')
  const label = os ? t('deviceLabel', { browser, os }) : browser === 'Browser' ? t('unknownBrowser') : row.label

  async function remove() {
    setPending(true)
    setError(null)
    try {
      const result = await removeDeviceAction(row.id)
      if (!result.ok) setError(result)
      else await onRemoved()
    } catch {
      setError('unexpected')
    } finally {
      setPending(false)
    }
  }

  return (
    <li className="flex flex-wrap items-center justify-between gap-x-5 gap-y-2 py-3.5 last:pb-0">
      <div className="flex min-w-0 flex-col gap-0.5">
        <span className="font-medium break-words">{label}</span>
        <span className="text-[13px] text-muted-foreground">{t('added', { date: row.added })}</span>
        {error === 'unexpected' ? (
          <span role="alert" className="text-sm text-destructive">
            {tCommon('genericError')}
          </span>
        ) : (
          error &&
          !error.ok && (
            <span role="alert" className="text-sm text-destructive">
              <ErrorCodeMessage code={error.code} />
            </span>
          )
        )}
      </div>
      <Button
        type="button"
        variant="ghost"
        size="sm"
        onClick={remove}
        disabled={pending}
        aria-label={t('removeLabel', { device: label })}
      >
        {t('remove')}
      </Button>
    </li>
  )
}
