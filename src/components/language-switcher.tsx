'use client'

import { useLocale, useTranslations } from 'next-intl'
import { useRouter } from 'next/navigation'
import { useTransition } from 'react'
import { setLocale } from '@/app/actions/locale'
import { LOCALES, type Locale } from '@/i18n/locale'

/** EN/FR toggle for the pill nav. Each button names its language in that language. */
export function LanguageSwitcher() {
  const t = useTranslations('common')
  const locale = useLocale()
  const router = useRouter()
  const [pending, startTransition] = useTransition()

  function choose(next: Locale) {
    if (next === locale) return
    startTransition(async () => {
      await setLocale(next)
      router.refresh()
    })
  }

  return (
    <div role="group" aria-label={t('language')} className="flex font-mono text-xs font-semibold tracking-[0.08em]">
      {LOCALES.map((value) => (
        <button
          key={value}
          type="button"
          lang={value}
          aria-pressed={locale === value}
          title={value === 'en' ? t('english') : t('french')}
          disabled={pending}
          onClick={() => choose(value)}
          className="h-11 min-w-11 rounded-full px-2 text-muted-foreground transition-colors outline-none hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50 disabled:opacity-60 aria-pressed:text-foreground"
        >
          {value.toUpperCase()}
        </button>
      ))}
    </div>
  )
}
