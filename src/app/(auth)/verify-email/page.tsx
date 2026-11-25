import { getTranslations } from 'next-intl/server'
import Link from 'next/link'
import { buttonVariants } from '@/components/ui/button'
import { WhatsAppInstead } from '@/components/whatsapp-number-form'
import { safeNextPath } from '@/lib/next-path'
import { emailNotSent } from '@/lib/verify-email'
import { whatsAppCodesOpen } from '@/server/auth/phone-verification'
import { getSessionUser } from '@/server/auth/session'
import { isVerificationPending } from '@/server/core/guards'
import { ResendVerificationEmail } from './resend-email'

export async function generateMetadata() {
  const t = await getTranslations('auth.verify')
  return { title: t('title') }
}

export default async function VerifyEmailPage({
  searchParams,
}: {
  searchParams: Promise<{ email?: string | string[]; next?: string | string[]; sent?: string | string[] }>
}) {
  const t = await getTranslations('auth.verify')
  const { email, next: rawNext, sent } = await searchParams
  const next = safeNextPath(rawNext)
  // Someone who never got the email can use WhatsApp instead, once signed in (the number goes on their own account).
  const user = await getSessionUser()
  const whatsapp = user !== null && isVerificationPending(user) && (await whatsAppCodesOpen())
  const address = typeof email === 'string' && email.length <= 254 ? email : null
  // Set by the sign-up form when the email could not be sent: say so instead of promising a link.
  const notSent = emailNotSent(sent)
  return (
    <>
      <div className="flex flex-col gap-2">
        <h1 className="font-display text-5xl leading-[0.95] tracking-[0.01em]">{t('title')}</h1>
        {notSent ? (
          <p role="alert" className="text-sm text-destructive">
            {address ? t('notSentTo', { email: address }) : t('notSent')}
          </p>
        ) : (
          <>
            <p className="text-sm text-muted-foreground">
              {address ? t('description', { email: address }) : t('descriptionNoEmail')}
            </p>
            <p className="text-sm text-muted-foreground">{t('hint')}</p>
          </>
        )}
      </div>
      {notSent && address ? <ResendVerificationEmail email={address} next={next} /> : null}
      {whatsapp ? <WhatsAppInstead next={next} /> : null}
      <Link href={next ? `/sign-in?next=${encodeURIComponent(next)}` : '/sign-in'} className={buttonVariants({ variant: 'outline', size: 'lg' })}>
        {t('backToSignIn')}
      </Link>
    </>
  )
}
