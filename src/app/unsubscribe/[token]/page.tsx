import type { Metadata } from 'next'
import { getTranslations } from 'next-intl/server'
import Link from 'next/link'
import { PageHeader, Panel } from '@/components/page-header'
import { SiteNav } from '@/components/site-nav'
import { buttonVariants } from '@/components/ui/button'
import { describeUnsubscribeLink } from '@/server/broadcasts/unsubscribe'
import { UnsubscribeForm } from './unsubscribe-form'

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('unsubscribe')
  // The token is in this address: never send it onward, and keep the page out of search results.
  return { title: t('title'), referrer: 'no-referrer', robots: { index: false, follow: false } }
}

/**
 * Where the footer link of an announcement email lands. Public (the token is the proof) and
 * read only: opening it changes nothing, the button does. An unknown token gets this friendly
 * page, not a 404.
 */
export default async function UnsubscribePage({ params }: PageProps<'/unsubscribe/[token]'>) {
  const { token } = await params
  const t = await getTranslations('unsubscribe')
  const state = await describeUnsubscribeLink(token)

  return (
    <>
      <SiteNav user={null} />
      <main className="mx-auto flex w-full max-w-xl flex-1 flex-col gap-8 px-4 pt-8 pb-20 sm:pt-12">
        <PageHeader title={t('title')} />
        <Panel className="flex flex-col gap-5">
          {state === 'unknown' ? (
            <UnknownLink />
          ) : (
            <UnsubscribeForm token={token} alreadyOff={state === 'already'} />
          )}
        </Panel>
      </main>
    </>
  )
}

async function UnknownLink() {
  const t = await getTranslations('unsubscribe')
  return (
    <>
      <p className="font-semibold">{t('unknown.title')}</p>
      <p className="text-muted-foreground">{t('unknown.body')}</p>
      <div>
        <Link href="/settings" className={buttonVariants({ variant: 'outline' })}>
          {t('settingsLink')}
        </Link>
      </div>
    </>
  )
}
