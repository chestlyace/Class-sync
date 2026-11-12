import { RotateCw, WifiOff } from 'lucide-react'
import { getTranslations } from 'next-intl/server'
import { Logo } from '@/components/logo'
import { Panel } from '@/components/page-header'
import { buttonVariants } from '@/components/ui/button'

export async function generateMetadata() {
  const t = await getTranslations('offline')
  return { title: t('title') }
}

/**
 * What the service worker shows when a page can't load for lack of a connection (public/sw.js
 * caches this page at install). It is served under the URL that failed, often without its
 * scripts, so "Try again" is a plain link to that same URL: it works without JavaScript.
 */
export default async function OfflinePage() {
  const t = await getTranslations('offline')
  return (
    <main className="mx-auto flex w-full max-w-xl flex-1 flex-col justify-center gap-8 px-4 py-16">
      <Logo className="h-7" />
      <Panel className="flex flex-col items-start gap-5">
        <WifiOff aria-hidden="true" className="size-6 text-muted-foreground" />
        <div className="flex flex-col gap-2">
          <h1 className="font-display text-5xl leading-[0.95] tracking-[0.01em]">{t('title')}</h1>
          <p className="text-muted-foreground">{t('body')}</p>
        </div>
        {/* An empty href is the current page: following it reloads whatever failed. */}
        <a href="" className={buttonVariants()}>
          <RotateCw aria-hidden="true" />
          {t('retry')}
        </a>
      </Panel>
    </main>
  )
}
