import type { Locale } from '@/server/core/context'

export type { Locale }
export const LOCALES = ['en', 'fr'] as const satisfies readonly Locale[]
export const DEFAULT_LOCALE: Locale = 'en'
export const LOCALE_COOKIE = 'NEXT_LOCALE'

export function isLocale(value: unknown): value is Locale {
  return typeof value === 'string' && (LOCALES as readonly string[]).includes(value)
}

/** First supported language in an Accept-Language header, honouring q-values. */
function fromAcceptLanguage(header: string | null | undefined): Locale | undefined {
  if (!header) return undefined
  const ranked = header
    .split(',')
    .map((part, index) => {
      const [tag, ...params] = part.trim().split(';')
      const q = params.map((p) => p.trim()).find((p) => p.startsWith('q='))
      const weight = q ? Number.parseFloat(q.slice(2)) : 1
      return { lang: tag.trim().toLowerCase().split('-')[0], weight, index }
    })
    .filter((entry) => entry.lang && Number.isFinite(entry.weight) && entry.weight > 0)
    .sort((a, b) => b.weight - a.weight || a.index - b.index)
  return ranked.map((entry) => entry.lang).find(isLocale)
}

/** Signed-in user's saved locale > NEXT_LOCALE cookie > Accept-Language > English. */
export function resolveLocale(input: {
  userLocale?: string | null
  cookie?: string | null
  acceptLanguage?: string | null
}): Locale {
  if (isLocale(input.userLocale)) return input.userLocale
  if (isLocale(input.cookie)) return input.cookie
  return fromAcceptLanguage(input.acceptLanguage) ?? DEFAULT_LOCALE
}
