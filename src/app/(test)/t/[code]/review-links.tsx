'use client'

import { Hourglass, ListChecks, RotateCcw } from 'lucide-react'
import { useTranslations } from 'next-intl'
import Link from 'next/link'
import { buttonVariants } from '@/components/ui/button'
import type { ReviewAccess } from '@/server/tests/review'

/**
 * After a test: "Review answers" and "Practise this test" once review is open; a quiet line while
 * it waits for the results or for the other classes; nothing when the lecturer turned review off.
 */
export function ReviewLinks({ code, access }: { code: string; access: ReviewAccess | null }) {
  const t = useTranslations('tests.review')
  if (access === null || access === 'off') return null
  if (access !== 'open') {
    return (
      <p className="flex items-start gap-2 text-sm text-muted-foreground">
        <Hourglass aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
        {access === 'waiting_classes' ? t('waitingClasses') : t('waitingResults')}
      </p>
    )
  }
  const base = `/t/${encodeURIComponent(code)}`
  return (
    <div className="flex flex-col gap-2.5 sm:flex-row">
      <Link href={`${base}/review`} className={buttonVariants({ size: 'lg' })}>
        <ListChecks aria-hidden="true" data-icon="inline-start" />
        {t('reviewAnswers')}
      </Link>
      <Link href={`${base}/practice`} className={buttonVariants({ variant: 'outline', size: 'lg' })}>
        <RotateCcw aria-hidden="true" data-icon="inline-start" />
        {t('practise')}
      </Link>
    </div>
  )
}
