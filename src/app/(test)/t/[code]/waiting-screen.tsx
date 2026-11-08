'use client'

import { Eye, Hourglass, Smartphone } from 'lucide-react'
import { useLocale, useTranslations } from 'next-intl'
import { Eyebrow, PageHeader, Panel } from '@/components/page-header'
import { formatDecimal } from '@/lib/number-format'
import type { TestInfo } from '@/server/tests/attempt'
import { SyncLine, type SyncStatus } from './screen-parts'

/** Before Start (`PhoneTestWaiting`): what the test is and the exact leaving rule. Polls for Start. */
export function WaitingScreen({ info, status }: { info: TestInfo; status: SyncStatus }) {
  const t = useTranslations('tests.student')
  const locale = useLocale()
  const facts = [
    { label: t('facts.duration'), value: t('facts.durationValue', { minutes: info.durationMinutes }) },
    { label: t('facts.questions'), value: String(info.questionCount) },
    { label: t('facts.marks'), value: formatDecimal(info.totalMarks, locale) },
  ]
  return (
    <>
      <PageHeader eyebrow={`${t('waiting.eyebrow')} · ${info.courseTitle}`} title={info.title} />
      <dl className="grid grid-cols-3 divide-x rounded-3xl border">
        {facts.map((f) => (
          <div key={f.label} className="flex min-w-0 flex-col gap-1 px-3 py-4 sm:px-5">
            <dt>
              <Eyebrow className="text-[11px]">{f.label}</Eyebrow>
            </dt>
            <dd className="font-display text-4xl leading-none">{f.value}</dd>
          </div>
        ))}
      </dl>
      <Panel className="flex flex-col gap-3">
        <p className="font-medium">
          {t('waiting.rule', { exits: info.rule.maxExits, seconds: info.rule.maxAbsenceSeconds })}
        </p>
        <p className="text-sm text-muted-foreground">{t('waiting.ruleWhat')}</p>
      </Panel>
      <ul className="flex flex-col gap-3 text-sm">
        <li className="flex items-start gap-3">
          <Smartphone aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
          {t('waiting.saved')}
        </li>
        <li className="flex items-start gap-3">
          <Eye aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
          {t('waiting.notice')}
        </li>
      </ul>
      <div className="flex flex-col gap-2 rounded-3xl bg-muted p-5">
        <p className="flex items-start gap-3 font-medium">
          <Hourglass aria-hidden="true" className="mt-0.5 size-5 shrink-0" />
          {t('waiting.status')}
        </p>
        <SyncLine status={status} className="pl-8" />
      </div>
    </>
  )
}
