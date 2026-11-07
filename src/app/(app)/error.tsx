'use client'

import { RotateCcw, TriangleAlert } from 'lucide-react'
import { useTranslations } from 'next-intl'
import Link from 'next/link'
import { useEffect } from 'react'
import { Panel } from '@/components/page-header'
import { Button, buttonVariants } from '@/components/ui/button'

/** Unexpected error while rendering a signed-in page (the nav stays; this replaces the page). */
export default function AppError({ error, retry }: { error: unknown; retry: () => void }) {
  const t = useTranslations()

  useEffect(() => {
    console.error(error)
  }, [error])

  return (
    <Panel role="alert" className="flex flex-col items-start gap-4">
      <TriangleAlert aria-hidden="true" className="size-6 text-muted-foreground" />
      <div className="flex flex-col gap-1">
        <h1 className="text-xl font-semibold tracking-tight">{t('errorBoundary.title')}</h1>
        <p className="text-muted-foreground">{t('errorBoundary.body')}</p>
      </div>
      <div className="flex flex-wrap gap-2.5">
        <Button type="button" onClick={() => retry()}>
          <RotateCcw aria-hidden="true" data-icon="inline-start" />
          {t('errorBoundary.retry')}
        </Button>
        <Link href="/dashboard" className={buttonVariants({ variant: 'outline' })}>
          {t('errorPage.backToDashboard')}
        </Link>
      </div>
    </Panel>
  )
}
