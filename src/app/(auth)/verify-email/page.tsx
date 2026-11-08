import { getTranslations } from 'next-intl/server'
import Link from 'next/link'
import { buttonVariants } from '@/components/ui/button'
import { safeNextPath } from '@/lib/next-path'

export async function generateMetadata() {
  const t = await getTranslations('auth.verify')
  return { title: t('title') }
}

export default async function VerifyEmailPage({
  searchParams,
}: {
  searchParams: Promise<{ email?: string | string[]; next?: string | string[] }>
}) {
  const t = await getTranslations('auth.verify')
  const { email, next: rawNext } = await searchParams
  const next = safeNextPath(rawNext)
  const address = typeof email === 'string' && email.length <= 254 ? email : null
  return (
    <>
      <div className="flex flex-col gap-2">
        <h1 className="font-display text-5xl leading-[0.95] tracking-[0.01em]">{t('title')}</h1>
        <p className="text-sm text-muted-foreground">
          {address ? t('description', { email: address }) : t('descriptionNoEmail')}
        </p>
        <p className="text-sm text-muted-foreground">{t('hint')}</p>
      </div>
      <Link href={next ? `/sign-in?next=${encodeURIComponent(next)}` : '/sign-in'} className={buttonVariants({ variant: 'outline', size: 'lg' })}>
        {t('backToSignIn')}
      </Link>
    </>
  )
}
