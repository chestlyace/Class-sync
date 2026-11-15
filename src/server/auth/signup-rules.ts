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

export const NAME_MAX_LENGTH = 80

// Tags, links and addresses: a name is shown to colleagues and students and, before this check,
// was repeated in the verification email sent to any address typed at sign-up.
const FORBIDDEN_IN_NAME = /[<>/\\@]|www\./i
const CONTROL_CHARACTER = /[\u0000-\u001f\u007f]/

function badName(message: string): AppError {
  return new AppError('VALIDATION', message, { fields: ['name'] })
}

/**
 * A person's name as Clasync stores it: trimmed, inner spaces collapsed, 1 to 80 characters, and
 * no tags, links, email addresses or control characters. Anything else is VALIDATION on `name`.
 */
export function cleanName(input: unknown): string {
  if (typeof input !== 'string') throw badName('Name is required')
  if (CONTROL_CHARACTER.test(input.replace(/[\t\n\r]/g, ' '))) throw badName('Name contains a control character')
  const name = input.trim().replace(/\s+/g, ' ')
  if (name === '') throw badName('Name is required')
  if (name.length > NAME_MAX_LENGTH) throw badName(`Name is longer than ${NAME_MAX_LENGTH} characters`)
  if (FORBIDDEN_IN_NAME.test(name)) throw badName('Name cannot contain links, email addresses or < > / \\')
  return name
}

/**
 * Checks a user update: the role never changes after sign-up, the locale must be supported, and a
 * new name is cleaned. Returns the update to apply.
 */
export function assertValidUserUpdate(data: Record<string, unknown>): Record<string, unknown> {
  if ('role' in data) {
    throw new AppError('VALIDATION', 'Role cannot be changed after sign-up')
  }
  if ('locale' in data && !isLocale(data.locale)) {
    throw new AppError('VALIDATION', 'Locale must be "en" or "fr"')
  }
  return 'name' in data ? { ...data, name: cleanName(data.name) } : data
}
