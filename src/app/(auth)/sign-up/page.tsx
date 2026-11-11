import { getLocale, getTranslations } from 'next-intl/server'
import Link from 'next/link'
import { isLocale } from '@/i18n/locale'
import { googleErrorKey } from '@/lib/auth-errors'
import { safeNextPath } from '@/lib/next-path'
import { isGoogleSignInEnabled } from '@/server/auth/google'
import { redirectIfSignedIn } from '../redirect-if-signed-in'
import { SignUpForm } from './sign-up-form'

export async function generateMetadata() {
  const t = await getTranslations('auth.signUp')
  return { title: t('title') }
}

export default async function SignUpPage({ searchParams }: PageProps<'/sign-up'>) {
  // The page that sent the visitor here (e.g. a test link), kept through sign-up and verification.
  const search = await searchParams
  const next = safeNextPath(search.next)
  await redirectIfSignedIn(next)
  const t = await getTranslations('auth.signUp')
  const locale = await getLocale()
  return (
    <>
      <div className="flex flex-col gap-1">
        <h1 className="font-display text-5xl leading-[0.95] tracking-[0.01em]">{t('title')}</h1>
        <p className="text-sm text-muted-foreground">{t('description')}</p>
      </div>
      <SignUpForm
        defaultLocale={isLocale(locale) ? locale : 'en'}
        next={next}
        google={isGoogleSignInEnabled()}
        // A Google sign-up that failed comes back here with `error` (and `next`, kept).
        googleError={googleErrorKey(search.error)}
      />
      <p className="text-center text-sm text-[#48484a]">
        {t('haveAccount')}{' '}
        <Link href={next ? `/sign-in?next=${encodeURIComponent(next)}` : '/sign-in'} className="font-medium text-primary underline-offset-4 hover:underline">
          {(await getTranslations('nav'))('signIn')}
        </Link>
      </p>
      <p className="text-center text-[13px] text-balance text-muted-foreground">
        {t.rich('legal', {
          terms: (chunks) => (
            <Link href="/terms" className="underline underline-offset-4 hover:text-foreground">
              {chunks}
            </Link>
          ),
          privacy: (chunks) => (
            <Link href="/privacy" className="underline underline-offset-4 hover:text-foreground">
              {chunks}
            </Link>
          ),
        })}
      </p>
    </>
  )
}
