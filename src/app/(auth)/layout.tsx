import { getTranslations } from 'next-intl/server'
import { SiteNav } from '@/components/site-nav'

/** Sign-in, sign-up and verify-email: the product line on wide screens, the form in a card beside it. */
export default async function AuthLayout({ children }: { children: React.ReactNode }) {
  const t = await getTranslations()
  return (
    <div className="flex flex-1 flex-col bg-muted">
      <SiteNav user={null} />
      <main className="mx-auto flex w-full max-w-5xl flex-1 flex-wrap items-center gap-12 px-4 py-8 sm:py-14">
        <div className="hidden min-w-0 flex-[999_1_420px] flex-col gap-5 lg:flex">
          <p className="font-display text-8xl leading-[0.88] tracking-[0.005em]">
            {t('landing.hero.titleLead')} <span className="text-muted-foreground">{t('landing.hero.titleTail')}</span>
          </p>
          <p className="max-w-md text-lg text-[#48484a]">{t('auth.aside')}</p>
        </div>
        <div className="mx-auto flex w-full max-w-[440px] flex-col gap-6 rounded-3xl border bg-background p-6 sm:p-8 lg:mx-0 lg:flex-[1_1_380px]">
          {children}
        </div>
      </main>
    </div>
  )
}
