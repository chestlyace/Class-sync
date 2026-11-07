import { SearchX } from 'lucide-react'
import { getTranslations } from 'next-intl/server'
import Link from 'next/link'
import { Panel } from '@/components/page-header'
import { SiteNav } from '@/components/site-nav'
import { buttonVariants } from '@/components/ui/button'
import { getSessionUser } from '@/server/auth/session'

export async function generateMetadata() {
  const t = await getTranslations('notFound')
  return { title: t('title') }
}

/** Unknown URL (or notFound()): rendered inside the root layout, so it brings its own nav. */
export default async function NotFound() {
  const t = await getTranslations('notFound')
  // Best effort, like the i18n config: a session lookup failure must not break the 404 page.
  const user = await getSessionUser().catch(() => null)
  return (
    <>
      <SiteNav user={user} />
      <main className="mx-auto flex w-full max-w-5xl flex-1 flex-col gap-10 px-4 pt-8 pb-20 sm:pt-12">
        <Panel className="flex flex-col items-start gap-4">
          <SearchX aria-hidden="true" className="size-6 text-muted-foreground" />
          <div className="flex flex-col gap-1">
            <h1 className="text-xl font-semibold tracking-tight">{t('title')}</h1>
            <p className="text-muted-foreground">{t('body')}</p>
          </div>
          <Link href={user ? '/dashboard' : '/'} className={buttonVariants({ variant: 'outline' })}>
            {user ? t('backToDashboard') : t('backHome')}
          </Link>
        </Panel>
      </main>
    </>
  )
}
