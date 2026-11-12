'use client'

import { Bell, Download, Share, SquarePlus } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { useEffect, useState } from 'react'
import { subscribePushAction } from '@/app/actions/push'
import { Button } from '@/components/ui/button'
import { firstOpenCard, readFirstOpenDismissed, rememberFirstOpenDismissed } from '@/lib/first-open'
import {
  onInstallPromptChange,
  readDeviceState,
  rememberInstallPrompt,
  storedInstallPrompt,
  turnOnPush,
  type DeviceState,
} from '@/lib/push-client'
import type { Role } from '@/server/core/context'

type Seen = DeviceState & { canPromptInstall: boolean; dismissed: boolean; phone: boolean }

function isPhone(): boolean {
  try {
    return window.matchMedia('(pointer: coarse)').matches
  } catch {
    return false
  }
}

/**
 * The dashboard's first-open card, decided in the browser (it depends on this device): students
 * are asked to turn notifications on (or, on iPhone/iPad Safari, to add Clasync to the Home Screen
 * first), lecturers to install the app. Nothing renders on the server or until the device is read.
 * The permission prompt only ever comes from a click on "Turn on".
 */
export function NotificationsCard({ role }: { role: Role }) {
  const t = useTranslations('dashboard.notificationsCard')
  const [seen, setSeen] = useState<Seen | null>(null)
  const [hidden, setHidden] = useState(false)
  const [pending, setPending] = useState(false)
  const [outcome, setOutcome] = useState<'denied' | 'failed' | null>(null)

  useEffect(() => {
    let alive = true
    async function read() {
      const device = await readDeviceState()
      if (!alive) return
      setSeen({
        ...device,
        canPromptInstall: storedInstallPrompt() !== null,
        dismissed: readFirstOpenDismissed(),
        phone: isPhone(),
      })
    }
    void read()
    // Chrome's install prompt can arrive after the card was decided.
    const stop = onInstallPromptChange(() => void read())
    return () => {
      alive = false
      stop()
    }
  }, [])

  // Once a message is showing, keep the card even though the permission is no longer "default".
  const kind = hidden || !seen ? null : outcome ? 'enable' : firstOpenCard({ role, ...seen })
  if (!kind) return null

  function notNow() {
    rememberFirstOpenDismissed()
    setHidden(true)
  }

  async function turnOn() {
    setPending(true)
    try {
      const result = await turnOnPush(subscribePushAction)
      if (result === 'on') setHidden(true)
      else setOutcome(result)
    } finally {
      setPending(false)
    }
  }

  async function install() {
    const prompt = storedInstallPrompt()
    if (!prompt) return
    // A prompt can be shown once: forget it straight away.
    const shown = prompt.prompt()
    rememberInstallPrompt(null)
    try {
      await shown
      if ((await prompt.userChoice).outcome === 'accepted') setHidden(true)
    } catch {
      // The browser refused to show it; the card goes with the prompt.
    }
  }

  const titleId = 'first-open-card-title'
  const ios = kind === 'install-ios'
  const title =
    kind === 'enable'
      ? t('enableTitle')
      : ios
        ? t('iosTitle')
        : seen?.phone
          ? t('installTitlePhone')
          : t('installTitleComputer')
  const body =
    kind === 'enable' ? t('enableBody') : ios ? (role === 'student' ? t('iosBodyStudent') : t('iosBodyLecturer')) : t('installBody')
  const Icon = kind === 'enable' ? Bell : Download

  return (
    <section
      aria-labelledby={titleId}
      data-testid="first-open-card"
      className="flex flex-col gap-4 rounded-3xl border bg-card px-5 py-5 sm:flex-row sm:items-start sm:gap-5 sm:px-7 sm:py-6"
    >
      <span
        aria-hidden="true"
        className="flex size-11 shrink-0 items-center justify-center rounded-full bg-muted text-foreground"
      >
        <Icon className="size-5" />
      </span>
      <div className="flex min-w-0 flex-1 flex-col gap-3">
        <div className="flex flex-col gap-1">
          <h2 id={titleId} className="text-lg leading-snug font-semibold text-pretty">
            {title}
          </h2>
          <p className="max-w-prose text-muted-foreground">{body}</p>
        </div>
        {ios && (
          <ol className="flex flex-col gap-2 text-sm text-foreground">
            <li className="flex items-center gap-2.5">
              <Share aria-hidden="true" className="size-4 shrink-0 text-primary" />
              {t('iosStep1')}
            </li>
            <li className="flex items-center gap-2.5">
              <SquarePlus aria-hidden="true" className="size-4 shrink-0 text-primary" />
              {t('iosStep2')}
            </li>
          </ol>
        )}
        {outcome && (
          <p role="status" className="max-w-prose text-sm text-muted-foreground">
            {outcome === 'denied' ? t('denied') : t('failed')}
          </p>
        )}
        <div className="flex flex-wrap gap-2">
          {kind === 'enable' && !outcome && (
            <Button type="button" onClick={turnOn} disabled={pending}>
              <Bell aria-hidden="true" data-icon="inline-start" />
              {pending ? t('turningOn') : t('turnOn')}
            </Button>
          )}
          {kind === 'install' && (
            <Button type="button" onClick={install}>
              <Download aria-hidden="true" data-icon="inline-start" />
              {t('install')}
            </Button>
          )}
          <Button type="button" variant="ghost" onClick={notNow}>
            {t('notNow')}
          </Button>
        </div>
      </div>
    </section>
  )
}
