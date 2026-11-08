'use client'

import { CalendarX, Lock, Maximize, MonitorSmartphone, WifiOff } from 'lucide-react'
import { useTranslations } from 'next-intl'
import Link from 'next/link'
import { PageHeader, Panel } from '@/components/page-header'
import { Button, buttonVariants } from '@/components/ui/button'

/** Laptop with full screen support, once the test runs: one tap enters full screen (the timer already runs). */
export function BeginScreen({ title, onBegin }: { title: string; onBegin: () => void }) {
  const t = useTranslations('tests.student.begin')
  return (
    <>
      <PageHeader eyebrow={title} title={t('title')} description={t('body')} />
      <p className="text-sm text-muted-foreground">{t('note')}</p>
      <Button type="button" size="lg" className="w-full" onClick={onBegin} autoFocus>
        <Maximize aria-hidden="true" data-icon="inline-start" />
        {t('button')}
      </Button>
    </>
  )
}

type Kind = 'open_elsewhere' | 'open_failed' | 'not_your_course' | 'closed'

const ICONS = { open_elsewhere: MonitorSmartphone, open_failed: WifiOff, not_your_course: Lock, closed: CalendarX }

/** A calm full-page message: already open on another device, could not open, not yours, or over. */
export function NoticeScreen({ kind, onRetry }: { kind: Kind; onRetry?: () => void }) {
  const t = useTranslations('tests.student')
  const Icon = ICONS[kind]
  const text = {
    open_elsewhere: { title: t('openElsewhere.title'), body: t('openElsewhere.body') },
    open_failed: { title: t('openFailed.title'), body: t('openFailed.body') },
    not_your_course: { title: t('notYourCourse.title'), body: t('notYourCourse.body') },
    closed: { title: t('closed.title'), body: t('closed.body') },
  }[kind]
  return (
    <Panel role={kind === 'closed' ? 'status' : 'alert'} className="flex flex-col items-start gap-4">
      <Icon aria-hidden="true" className="size-6 text-muted-foreground" />
      <div className="flex flex-col gap-1">
        <h1 className="text-xl font-semibold tracking-tight">{text.title}</h1>
        <p className="text-muted-foreground">{text.body}</p>
      </div>
      {onRetry ? (
        <Button type="button" onClick={onRetry}>
          {kind === 'open_elsewhere' ? t('openElsewhere.retry') : t('openFailed.retry')}
        </Button>
      ) : (
        <Link href="/dashboard" className={buttonVariants({ variant: 'outline' })}>
          {t('backToDashboard')}
        </Link>
      )}
    </Panel>
  )
}

/** Shown on the server render and while the first open is in flight. */
export function LoadingScreen() {
  const t = useTranslations('tests.student')
  return (
    <p role="status" className="text-muted-foreground">
      {t('loading')}
    </p>
  )
}
