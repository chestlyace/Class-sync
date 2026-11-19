import { getTranslations } from 'next-intl/server'
import { safeNextPath } from '@/lib/next-path'
import { ForgotPasswordForm } from './forgot-password-form'

export async function generateMetadata() {
  const t = await getTranslations('auth.forgotPassword')
  return { title: t('title') }
}

export default async function ForgotPasswordPage({ searchParams }: PageProps<'/forgot-password'>) {
  // Validated here and again on every hop, so an external destination can never ride along.
  const next = safeNextPath((await searchParams).next)
  return <ForgotPasswordForm next={next} />
}
