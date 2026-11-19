import type { Locale } from '@/server/core/context'
import { AuthLinkEmail } from './verify-email'

/** The link sent when someone asks to reset a password. It only opens a form; it changes nothing. */
export function ResetPasswordEmail({ url, locale }: { url: string; locale: Locale }) {
  return <AuthLinkEmail url={url} locale={locale} prefix="resetPassword" />
}
