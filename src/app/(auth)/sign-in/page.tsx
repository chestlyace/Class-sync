import { getTranslations } from 'next-intl/server'
import Link from 'next/link'
import { safeNextPath } from '@/lib/next-path'
import { oauthResumePath } from '@/lib/oauth-resume'
import { redirectIfSignedIn } from '../redirect-if-signed-in'
import { SignInForm } from './sign-in-form'

export async function generateMetadata() {
  const t = await getTranslations('auth.signIn')
  return { title: t('title') }
}

export default async function SignInPage({ searchParams }: PageProps<'/sign-in'>) {
  const search = await searchParams
  // Opened by an assistant's authorization (Better Auth's signed query): signing in here resumes it
  // (the auth client sends the query along); sign-up and verification carry it on as `next`.
  const oauthResume = oauthResumePath(search)
  const next = oauthResume ?? safeNextPath(search.next)
  // During an authorization the provider may ask to sign in again (prompt=login): show the form.
  if (!oauthResume) await redirectIfSignedIn(next)
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
        <Link href={next ? `/sign-up?next=${encodeURIComponent(next)}` : '/sign-up'} className="font-medium text-primary underline-offset-4 hover:underline">
          {t('createAccount')}
        </Link>
      </p>
    </>
  )
}
