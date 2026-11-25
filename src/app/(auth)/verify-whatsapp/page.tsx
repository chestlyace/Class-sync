import { getTranslations } from 'next-intl/server'
import { notFound, redirect } from 'next/navigation'
import { safeNextPath } from '@/lib/next-path'
import { toE164 } from '@/lib/phone'
import { getSessionUser } from '@/server/auth/session'
import { whatsAppVerificationEnabled } from '@/server/whatsapp/config'
import { VerifyWhatsAppForm } from './verify-whatsapp-form'

export async function generateMetadata() {
  const t = await getTranslations('auth.whatsapp')
  return { title: t('codeTitle') }
}

/**
 * The page a new account lands on after asking for a WhatsApp code: type the 6 digits. For signed-in
 * people only (the code is proof for that account). The number comes from the address; without a valid
 * one the page asks for the number first.
 */
export default async function VerifyWhatsAppPage({ searchParams }: PageProps<'/verify-whatsapp'>) {
  if (!whatsAppVerificationEnabled()) notFound()
  const search = await searchParams
  const next = safeNextPath(search.next)
  const user = await getSessionUser()
  if (!user) redirect(next ? `/sign-in?next=${encodeURIComponent(next)}` : '/sign-in')
  const phone = typeof search.phone === 'string' ? toE164(search.phone) : null
  // Why a code request at sign-up was refused: a code name only, never free text.
  const startError = typeof search.error === 'string' && /^[A-Z_]{1,40}$/.test(search.error) ? search.error : null
  return <VerifyWhatsAppForm phone={phone} alerts={search.alerts === '1'} next={next} email={user.email} startError={startError} />
}
