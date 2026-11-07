import { isLocale } from '@/i18n/locale'
import type { Locale, Role } from '@/server/core/context'
import { AppError } from '@/server/core/errors'

/** Public sign-up may only create lecturers and students; anything else is rejected. */
export function assertValidSignup(input: { role: unknown; locale: unknown }): {
  role: Role
  locale: Locale
} {
  if (input.role !== 'lecturer' && input.role !== 'student') {
    throw new AppError('VALIDATION', 'Role must be "lecturer" or "student"')
  }
  if (input.locale === undefined || input.locale === null) {
    return { role: input.role, locale: 'en' }
  }
  if (!isLocale(input.locale)) {
    throw new AppError('VALIDATION', 'Locale must be "en" or "fr"')
  }
  return { role: input.role, locale: input.locale }
}
