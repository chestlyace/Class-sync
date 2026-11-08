import { getTranslations } from 'next-intl/server'
import { LanguageSwitcher } from '@/components/language-switcher'

/**
 * Taking a test: the wordmark and the EN/FR toggle, no navigation (a link away would count as
 * leaving). The wordmark is plain text for the same reason.
 */
export default async function TestLayout({ children }: { children: React.ReactNode }) {
  const t = await getTranslations('common')
  return (
    <>
      <header className="px-4 pt-3 sm:pt-5">
        <div className="mx-auto flex max-w-xl items-center justify-between gap-2 rounded-full border bg-background py-1 pr-1 pl-5">
          <span className="font-display text-[26px] leading-none tracking-[0.04em] uppercase">{t('appName')}</span>
          <LanguageSwitcher />
        </div>
      </header>
      <main className="mx-auto flex w-full max-w-xl flex-1 flex-col gap-6 px-4 pt-6 pb-16 sm:pt-10">{children}</main>
    </>
  )
}
