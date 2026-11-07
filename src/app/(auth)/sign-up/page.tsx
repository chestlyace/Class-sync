import { getLocale, getTranslations } from 'next-intl/server'
import Link from 'next/link'
import { isLocale } from '@/i18n/locale'
import { SignUpForm } from './sign-up-form'

export async function generateMetadata() {
  const t = await getTranslations('auth.signUp')
  return { title: t('title') }
}

export default async function SignUpPage() {
  const t = await getTranslations('auth.signUp')
  const locale = await getLocale()
  return (
    <>
      <div className="flex flex-col gap-1">
        <h1 className="font-display text-5xl leading-[0.95] tracking-[0.01em]">{t('title')}</h1>
        <p className="text-sm text-muted-foreground">{t('description')}</p>
      </div>
      <SignUpForm defaultLocale={isLocale(locale) ? locale : 'en'} />
      <p className="text-sm text-muted-foreground">
        {t('haveAccount')}{' '}
        <Link href="/sign-in" className="font-medium text-foreground underline underline-offset-4">
          {(await getTranslations('nav'))('signIn')}
        </Link>
      </p>
    </>
  )
}
