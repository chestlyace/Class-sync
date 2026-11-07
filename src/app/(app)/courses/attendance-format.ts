import type { Locale } from '@/server/core/context'

const STYLES = {
  // "Monday 9 Nov, 08:30" / "lundi 9 nov., 08:30"
  long: { weekday: 'long', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' },
  // "Mon 9 Nov, 08:30" / "lun. 9 nov., 08:30" (grid column headers)
  short: { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' },
  // "08:30" (when a check-in closes)
  time: { hour: '2-digit', minute: '2-digit' },
} satisfies Record<string, Intl.DateTimeFormatOptions>

/** When a session took place, in the school's time zone (24-hour clock in both languages). */
export function formatSessionDate(
  date: Date,
  locale: Locale,
  timeZone: string,
  style: keyof typeof STYLES = 'long',
): string {
  return new Intl.DateTimeFormat(locale === 'fr' ? 'fr-FR' : 'en-GB', {
    ...STYLES[style],
    hourCycle: 'h23',
    timeZone,
  }).format(date)
}
