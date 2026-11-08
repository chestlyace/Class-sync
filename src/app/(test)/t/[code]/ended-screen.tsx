'use client'

import { RefreshCw } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { PageHeader, Panel } from '@/components/page-header'
import { SyncLine, type SyncStatus } from './screen-parts'

/** Ended for leaving (`PhoneTestEnded`): why, what was handed in; reopens by itself if let back in. */
export function EndedScreen({
  reason,
  exits,
  maxAbsenceSeconds,
  answered,
  hasShort,
  status,
}: {
  reason: 'exits' | 'absence'
  exits: number
  maxAbsenceSeconds: number
  answered: number
  hasShort: boolean
  status: SyncStatus
}) {
  const t = useTranslations('tests.student.ended')
  return (
    <>
      <PageHeader eyebrow={t('eyebrow')} title={t('title')} />
      <Panel className="flex flex-col gap-3">
        <p className="font-medium">
          {reason === 'exits' ? t('exits', { count: exits }) : t('absence', { seconds: maxAbsenceSeconds })}
        </p>
        <p>{t('handedIn', { count: answered })}</p>
        {!hasShort && <p className="text-muted-foreground">{t('totalLater')}</p>}
      </Panel>
      <div className="flex flex-col gap-2 rounded-3xl bg-muted p-5">
        <p className="flex items-start gap-3">
          <RefreshCw aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
          {t('reopen')}
        </p>
        <SyncLine status={status} className="pl-7" />
      </div>
    </>
  )
}
