import { getTranslations } from 'next-intl/server'
import { headers } from 'next/headers'
import { redirect } from 'next/navigation'
import { LanguageSwitcher } from '@/components/language-switcher'
import { Logo } from '@/components/logo'
import { REQUEST_PATH_HEADER, safeNextPath } from '@/lib/next-path'
import { getSessionUser } from '@/server/auth/session'

/**
 * Taking a test: the wordmark and the EN/FR toggle, no navigation (a link away would count as
 * leaving). The logo is not a link for the same reason. `data-taking-test` turns off
 * pull-to-refresh for the page (globals.css): an over-drag at the top must not reload the test.
 * Every page here needs a signed-in student; a signed-out visitor is sent to sign in from here,
 * above the loading boundary, so the redirect is an instant 307 and not a streamed meta-refresh.
 */
export default async function TestLayout({ children }: { children: React.ReactNode }) {
  const user = await getSessionUser()
  if (!user) {
    const next = safeNextPath((await headers()).get(REQUEST_PATH_HEADER))
    redirect(next ? `/sign-in?next=${encodeURIComponent(next)}` : '/sign-in')
  }
  const t = await getTranslations('common')
  return (
    <>
      <header className="px-4 pt-3 sm:pt-5">
        <div className="mx-auto flex max-w-xl items-center justify-between gap-2 rounded-full border bg-background py-1 pr-1 pl-5">
          <Logo className="h-[22px]" title={t('appName')} />
          <LanguageSwitcher />
        </div>
      </header>
      <main data-taking-test className="mx-auto flex w-full max-w-xl flex-1 flex-col gap-6 px-4 pt-6 pb-16 sm:pt-10">{children}</main>
    </>
  )
}
