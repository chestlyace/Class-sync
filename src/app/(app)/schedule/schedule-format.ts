import type { Locale } from '@/server/core/context'

const tag = (locale: Locale) => (locale === 'fr' ? 'fr-FR' : 'en-GB')

const pad2 = (n: number) => String(n).padStart(2, '0')

/** Minutes after midnight as "08:30". */
export function minutesToTime(minutes: number): string {
  return `${pad2(Math.floor(minutes / 60))}:${pad2(minutes % 60)}`
}

/** An instant's wall-clock time in `timeZone`, 24-hour ("08:30") in both languages. */
export function formatTime(at: Date, timeZone: string): string {
  return new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit', hourCycle: 'h23', timeZone }).format(
    at,
  )
}

/** "YYYY-MM-DD" as a UTC midnight, so formatting never shifts the calendar day. */
const utc = (date: string) => {
  const [y, m, d] = date.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, d))
}

const DAY_STYLES = {
  // "Mon 10" / "lun. 10" (day headings, in uppercase mono; make-up badges)
  short: { weekday: 'short', day: 'numeric' },
  // "Mon 3 Nov" / "lun. 3 nov."
  medium: { weekday: 'short', day: 'numeric', month: 'short' },
  // "Monday 10 November" / "lundi 10 novembre"
  long: { weekday: 'long', day: 'numeric', month: 'long' },
  // "10 Nov 2026" / "10 nov. 2026"
  date: { day: 'numeric', month: 'short', year: 'numeric' },
} satisfies Record<string, Intl.DateTimeFormatOptions>

/** A local calendar date ("YYYY-MM-DD") in the reader's language. */
export function formatDay(date: string, locale: Locale, style: keyof typeof DAY_STYLES): string {
  return new Intl.DateTimeFormat(tag(locale), { ...DAY_STYLES[style], timeZone: 'UTC' }).format(utc(date))
}

/** ISO weekday (1 = Monday) by name: "Monday" / "lundi". */
export function weekdayName(weekday: number, locale: Locale): string {
  // 1 January 2024 was a Monday.
  return new Intl.DateTimeFormat(tag(locale), { weekday: 'long', timeZone: 'UTC' }).format(
    new Date(Date.UTC(2024, 0, weekday)),
  )
}

/** "10–16 Nov" / "10–16 nov." for the seven days from `weekStart`. */
export function formatWeekRange(weekStart: string, weekEnd: string, locale: Locale): string {
  return new Intl.DateTimeFormat(tag(locale), { day: 'numeric', month: 'short', timeZone: 'UTC' }).formatRange(
    utc(weekStart),
    utc(weekEnd),
  )
}
