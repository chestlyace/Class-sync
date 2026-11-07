import { getTranslations } from 'next-intl/server'
import Link from 'next/link'
import { SignInForm } from './sign-in-form'

export async function generateMetadata() {
  const t = await getTranslations('auth.signIn')
  return { title: t('title') }
}

export default async function SignInPage() {
  const t = await getTranslations('auth.signIn')
  return (
    <>
      <div className="flex flex-col gap-1">
        <h1 className="font-display text-5xl leading-[0.95] tracking-[0.01em]">{t('title')}</h1>
        <p className="text-sm text-muted-foreground">{t('description')}</p>
      </div>
      <SignInForm />
      <p className="text-sm text-muted-foreground">
        {t('noAccount')}{' '}
        <Link href="/sign-up" className="font-medium text-foreground underline underline-offset-4">
          {(await getTranslations('nav'))('signUp')}
        </Link>
      </p>
    </>
  )
}
