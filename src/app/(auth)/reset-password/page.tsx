import { getTranslations } from 'next-intl/server'
import { safeNextPath } from '@/lib/next-path'
import { ResetPasswordForm } from './reset-password-form'

export async function generateMetadata() {
  const t = await getTranslations('auth.resetPassword')
  return { title: t('title') }
}

export default async function ResetPasswordPage({ searchParams }: PageProps<'/reset-password'>) {
  const search = await searchParams
  // The email link carries the raw token; bound its length before handing it to the auth client.
  const token = typeof search.token === 'string' && search.token.length > 0 && search.token.length <= 200 ? search.token : null
  const next = safeNextPath(search.next)
  return <ResetPasswordForm token={token} next={next} />
}
