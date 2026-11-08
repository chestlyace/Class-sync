'use client'

import { CircleCheck, ListChecks, LoaderCircle } from 'lucide-react'
import { useLocale, useTranslations } from 'next-intl'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { PageHeader, Panel } from '@/components/page-header'
import { Button, buttonVariants } from '@/components/ui/button'
import { formatDecimal } from '@/lib/number-format'
import type { QuickResult, TestInfo } from '@/server/tests/attempt'
import { resultState } from './runner-logic'

/**
 * Handed in / result (`PhoneTestResult`): the total only, never which questions were right. MCQ-only
 * before the total is final: "in a moment" (the runner keeps polling); with short answers: waits for
 * the lecturer's release.
 */
export function ResultScreen({ info, result }: { info: TestInfo; result: QuickResult | null }) {
  const t = useTranslations('tests.student')
  const tr = useTranslations('tests.released')
  const locale = useLocale()
  const router = useRouter()
  const state = resultState({ hasShort: info.hasShort, result })
  return (
    <>
      <PageHeader eyebrow={`${t('result.eyebrow')} · ${info.courseTitle}`} title={info.title} />
      {state === 'score' && result ? (
        <Panel className="flex flex-col items-center gap-2 py-10 text-center">
          <span className="font-mono text-xs font-medium tracking-[0.1em] text-muted-foreground uppercase">
            {t('result.title')}
          </span>
          <span className="font-display text-8xl leading-none">
            {t('result.score', { score: formatDecimal(result.score, locale), outOf: formatDecimal(result.outOf, locale) })}
          </span>
          {!info.hasShort && (
            <span className="text-lg text-muted-foreground">
              {t('result.right', { right: result.mcqCorrect, count: result.mcqCount })}
            </span>
          )}
          {info.hasShort && (
            // Released while this page was open: the page itself shows marks and comments.
            <Button type="button" variant="outline" className="mt-2" onClick={() => router.refresh()}>
              <ListChecks aria-hidden="true" data-icon="inline-start" />
              {tr('seeMarks')}
            </Button>
          )}
        </Panel>
      ) : (
        <Panel role="status" className="flex items-start gap-3">
          {state === 'pending' ? (
            <LoaderCircle aria-hidden="true" className="mt-0.5 size-5 shrink-0 animate-spin motion-reduce:animate-none" />
          ) : (
            <CircleCheck aria-hidden="true" className="mt-0.5 size-5 shrink-0" />
          )}
          <p className="font-medium">{state === 'pending' ? t('result.pending') : t('result.awaitingRelease')}</p>
        </Panel>
      )}
      <Link href="/dashboard" className={buttonVariants({ variant: 'outline', size: 'lg', className: 'self-start' })}>
        {t('backToDashboard')}
      </Link>
    </>
  )
}
