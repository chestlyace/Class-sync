'use client'

import { useLocale, useTranslations } from 'next-intl'
import { useRouter } from 'next/navigation'
import { useTransition } from 'react'
import { setLocale } from '@/app/actions/locale'
import { isLocale } from '@/i18n/locale'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'

export function LanguageSwitcher() {
  const t = useTranslations('common')
  const locale = useLocale()
  const router = useRouter()
  const [pending, startTransition] = useTransition()

  return (
    <Select
      value={locale}
      disabled={pending}
      onValueChange={(next) => {
        if (!isLocale(next) || next === locale) return
        startTransition(async () => {
          await setLocale(next)
          router.refresh()
        })
      }}
    >
      <SelectTrigger size="sm" aria-label={t('language')} className="w-auto min-w-28">
        <SelectValue />
      </SelectTrigger>
      <SelectContent align="end">
        <SelectItem value="en">{t('english')}</SelectItem>
        <SelectItem value="fr">{t('french')}</SelectItem>
      </SelectContent>
    </Select>
  )
}
