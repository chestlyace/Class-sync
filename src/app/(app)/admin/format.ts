import { getLocale } from 'next-intl/server'
import { DEFAULT_LOCALE, isLocale, type Locale } from '@/i18n/locale'
import { config } from '@/server/core/config'

export type Formatters = {
  locale: Locale
  /** "9 Nov 2026" / "9 nov. 2026". */
  day: (date: Date) => string
  /** "9 Nov 2026, 14:05" / "9 nov. 2026, 14:05". */
  dateTime: (date: Date) => string
  number: (n: number) => string
  /** 1 234 567 bytes as "1.2 MB" / "1,2 Mo". */
  bytes: (n: number) => string
}

const BYTE_UNITS = ['byte', 'kilobyte', 'megabyte', 'gigabyte', 'terabyte'] as const

/** Dates, times and numbers for the admin pages, in the reader's language and the app's time zone. */
export async function getFormatters(): Promise<Formatters> {
  const raw = await getLocale()
  const locale = isLocale(raw) ? raw : DEFAULT_LOCALE
  const tag = locale === 'fr' ? 'fr-FR' : 'en-GB'
  const day = new Intl.DateTimeFormat(tag, { day: 'numeric', month: 'short', year: 'numeric', timeZone: config.timeZone })
  const dateTime = new Intl.DateTimeFormat(tag, {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    timeZone: config.timeZone,
  })
  const number = new Intl.NumberFormat(tag)
  return {
    locale,
    day: (d) => day.format(d),
    dateTime: (d) => dateTime.format(d),
    number: (n) => number.format(n),
    bytes: (n) => {
      let value = n
      let unit = 0
      while (value >= 1000 && unit < BYTE_UNITS.length - 1) {
        value /= 1000
        unit += 1
      }
      return new Intl.NumberFormat(tag, {
        style: 'unit',
        unit: BYTE_UNITS[unit],
        unitDisplay: 'short',
        maximumFractionDigits: unit === 0 ? 0 : 1,
      }).format(value)
    },
  }
}
