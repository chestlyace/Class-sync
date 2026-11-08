import { getTranslations } from 'next-intl/server'
import Link from 'next/link'
import { safeNextPath } from '@/lib/next-path'
import { redirectIfSignedIn } from '../redirect-if-signed-in'
import { SignInForm } from './sign-in-form'

export async function generateMetadata() {
  const t = await getTranslations('auth.signIn')
  return { title: t('title') }
}

export default async function SignInPage({ searchParams }: PageProps<'/sign-in'>) {
  const next = safeNextPath((await searchParams).next)
  await redirectIfSignedIn(next)
  const t = await getTranslations('auth.signIn')
  return (
    <>
      <div className="flex flex-col gap-1">
        <h1 className="font-display text-5xl leading-[0.95] tracking-[0.01em]">{t('title')}</h1>
        <p className="text-sm text-muted-foreground">{t('description')}</p>
      </div>
      <SignInForm next={next} />
      <p className="text-center text-sm text-[#48484a]">
        {t('noAccount')}{' '}
        <Link href="/sign-up" className="font-medium text-primary underline-offset-4 hover:underline">
          {t('createAccount')}
        </Link>
      </p>
    </>
  )
}
