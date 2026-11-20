import type { Metadata } from 'next'
import { getTranslations } from 'next-intl/server'
import { safeNextPath } from '@/lib/next-path'
import { describeResetLink } from '@/server/auth/reset-link'
import { ResetPasswordForm } from './reset-password-form'

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('auth.resetPassword')
  // The token stays in this page's address (so a reload keeps working): never send it onward.
  return { title: t('title'), referrer: 'no-referrer' }
}

export default async function ResetPasswordPage({ searchParams }: PageProps<'/reset-password'>) {
  const search = await searchParams
  // The email link carries the raw token; bound its length before looking it up.
  const token = typeof search.token === 'string' && search.token.length > 0 && search.token.length <= 200 ? search.token : null
  const next = safeNextPath(search.next)
  // Checked now, so an expired or used link says so before anyone types a new password.
  const link = await describeResetLink(token)
  return <ResetPasswordForm token={token} email={link.status === 'valid' ? link.email : null} next={next} />
}
