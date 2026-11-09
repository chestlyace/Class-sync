import { getTranslations } from 'next-intl/server'
import { LanguageSwitcher } from '@/components/language-switcher'
import { Logo } from '@/components/logo'

/** Assistant authorization pages: the wordmark and the EN/FR toggle, no navigation away. */
export default async function OAuthLayout({ children }: { children: React.ReactNode }) {
  const t = await getTranslations('common')
  return (
    <div className="flex flex-1 flex-col bg-muted">
      <header className="px-4 pt-3 sm:pt-5">
        <div className="mx-auto flex max-w-xl items-center justify-between gap-2 rounded-full border bg-background py-1 pr-1 pl-5">
          <Logo className="h-[22px]" title={t('appName')} />
          <LanguageSwitcher />
        </div>
      </header>
      <main className="mx-auto flex w-full max-w-xl flex-1 flex-col px-4 pt-6 pb-16 sm:pt-10">
        <div className="flex flex-col gap-6 rounded-3xl border bg-background p-6 sm:p-8">{children}</div>
      </main>
    </div>
  )
}
