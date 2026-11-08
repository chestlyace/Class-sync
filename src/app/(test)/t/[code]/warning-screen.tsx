'use client'

import { ArrowRight, Maximize, TriangleAlert } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { Eyebrow, PageHeader } from '@/components/page-header'
import { Button } from '@/components/ui/button'
import type { LeavingRule } from '@/server/tests/leaving'
import { formatCountdown } from './runner-logic'
import { SyncLine, useFormatSpan, type SyncStatus } from './screen-parts'

/**
 * Back after leaving (`PhoneTestWarning`): which exit this was, time away, what happens next time,
 * time left. `awayMs` is null while the student is still away (a laptop out of full screen): the
 * time then runs live and the button takes them back to full screen.
 */
export function WarningScreen({
  exitNumber,
  rule,
  awayMs,
  liveAwayMs,
  msLeft,
  status,
  fullscreen,
  onContinue,
}: {
  exitNumber: number
  rule: LeavingRule
  awayMs: number | null
  liveAwayMs: number
  msLeft: number
  status: SyncStatus
  /** Show "Back to full screen" instead of "Back to the questions". */
  fullscreen: boolean
  onContinue: () => void
}) {
  const t = useTranslations('tests.student.warning')
  const formatSpan = useFormatSpan()
  const remaining = Math.max(0, rule.maxExits - exitNumber)
  return (
    <>
      <PageHeader title={t('title', { n: exitNumber, max: rule.maxExits })} />
      <dl className="grid grid-cols-2 divide-x rounded-3xl border">
        <div className="flex flex-col gap-1 px-4 py-4 sm:px-5">
          <dt>
            <Eyebrow>{t('away')}</Eyebrow>
          </dt>
          <dd className="font-display text-4xl leading-none">{formatSpan(awayMs ?? liveAwayMs)}</dd>
        </div>
        <div className="flex flex-col gap-1 px-4 py-4 sm:px-5">
          <dt>
            <Eyebrow>{t('timeLeft')}</Eyebrow>
          </dt>
          <dd className="font-display text-4xl leading-none tabular-nums">{formatCountdown(msLeft)}</dd>
        </div>
      </dl>
      <div className="flex items-start gap-3 rounded-3xl bg-muted p-5 font-medium">
        <TriangleAlert aria-hidden="true" className="mt-0.5 size-5 shrink-0" />
        <div className="flex flex-col gap-2">
          <p>
            {remaining <= 1 ? t('nextEnds') : t('nextMore', { count: remaining, seconds: rule.maxAbsenceSeconds })}
          </p>
          {awayMs === null && <p>{t('stillAway', { seconds: rule.maxAbsenceSeconds })}</p>}
        </div>
      </div>
      <div className="flex flex-col gap-1">
        <p>{t('saved')}</p>
        <SyncLine status={status} />
      </div>
      <Button type="button" size="lg" className="w-full" onClick={onContinue} autoFocus>
        {fullscreen ? (
          <Maximize aria-hidden="true" data-icon="inline-start" />
        ) : (
          <ArrowRight aria-hidden="true" data-icon="inline-start" />
        )}
        {fullscreen ? t('fullscreen') : t('continue')}
      </Button>
    </>
  )
}
