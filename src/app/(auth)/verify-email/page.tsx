import { getTranslations } from 'next-intl/server'
import Link from 'next/link'
import { buttonVariants } from '@/components/ui/button'

export async function generateMetadata() {
  const t = await getTranslations('auth.verify')
  return { title: t('title') }
}

export default async function VerifyEmailPage({
  searchParams,
}: {
  searchParams: Promise<{ email?: string | string[] }>
}) {
  const t = await getTranslations('auth.verify')
  const { email } = await searchParams
  const address = typeof email === 'string' && email.length <= 254 ? email : null
  return (
    <>
      <div className="flex flex-col gap-2">
        <h1 className="text-2xl font-semibold tracking-tight">{t('title')}</h1>
        <p className="text-sm text-muted-foreground">
          {address ? t('description', { email: address }) : t('descriptionNoEmail')}
        </p>
        <p className="text-sm text-muted-foreground">{t('hint')}</p>
      </div>
      <Link href="/sign-in" className={buttonVariants({ variant: 'outline', size: 'lg' })}>
        {t('backToSignIn')}
      </Link>
    </>
  )
}
