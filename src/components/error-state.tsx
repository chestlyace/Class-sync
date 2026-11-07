import { ShieldAlert } from 'lucide-react'
import { getTranslations } from 'next-intl/server'
import Link from 'next/link'
import { buttonVariants } from '@/components/ui/button'
import type { ErrorCode } from '@/server/core/errors'
import { Panel } from './page-header'

/** In-page message for a service error (e.g. FORBIDDEN on someone else's course). */
export async function ErrorState({ code }: { code: ErrorCode }) {
  const t = await getTranslations()
  return (
    <Panel role="alert" className="flex flex-col items-start gap-4">
      <ShieldAlert aria-hidden="true" className="size-6 text-muted-foreground" />
      <div className="flex flex-col gap-1">
        <h1 className="text-xl font-semibold tracking-tight">{t('errorPage.title')}</h1>
        <p className="text-muted-foreground">{t(`errors.${code}`)}</p>
      </div>
      <Link href="/dashboard" className={buttonVariants({ variant: 'outline' })}>
        {t('errorPage.backToDashboard')}
      </Link>
    </Panel>
  )
}
