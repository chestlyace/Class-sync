const WALL = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/

const formatters = new Map<string, Intl.DateTimeFormat>()

function formatter(timeZone: string): Intl.DateTimeFormat {
  let f = formatters.get(timeZone)
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', {
      timeZone,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    })
    formatters.set(timeZone, f)
  }
  return f
}

/** The wall-clock fields of an instant in a zone. Throws RangeError for an unknown zone. */
function wallParts(ms: number, timeZone: string) {
  const p: Record<string, number> = {}
  for (const part of formatter(timeZone).formatToParts(new Date(ms))) {
    if (part.type !== 'literal') p[part.type] = Number(part.value)
  }
  return p as { year: number; month: number; day: number; hour: number; minute: number; second: number }
}

/** Zone offset from UTC, in ms, in force at the given instant. */
function offsetAt(ms: number, timeZone: string): number {
  const w = wallParts(ms, timeZone)
  const asUtc = Date.UTC(w.year, w.month - 1, w.day, w.hour, w.minute, w.second)
  return asUtc - Math.floor(ms / 1000) * 1000
}

/**
 * Reads a `datetime-local` value ("2026-11-12T08:00") as a wall time in `timeZone` and returns the instant.
 * The zone's offset is looked up for that date, so DST zones are handled. A wall time that doesn't exist
 * (spring-forward gap) resolves to the same offset-shifted instant after the gap; an ambiguous one (autumn overlap)
 * resolves to its second occurrence.
 * Returns null for anything that isn't a real date or an unknown zone.
 */
export function parseLocalDateTime(value: string, timeZone: string): Date | null {
  const m = WALL.exec(value.trim())
  if (!m) return null
  const [y, mo, d, h, mi, s] = [m[1], m[2], m[3], m[4], m[5], m[6] ?? '0'].map(Number)
  const guess = Date.UTC(y, mo - 1, d, h, mi, s)
  const check = new Date(guess)
  if (
    check.getUTCFullYear() !== y ||
    check.getUTCMonth() !== mo - 1 ||
    check.getUTCDate() !== d ||
    check.getUTCHours() !== h ||
    check.getUTCMinutes() !== mi
  ) {
    return null
  }
  try {
    // Try the offset at the naive instant, then re-resolve with the offset at the result (handles DST edges).
    const first = guess - offsetAt(guess, timeZone)
    const second = guess - offsetAt(first, timeZone)
    return new Date(second)
  } catch {
    return null
  }
}

/** Formats an instant as a `datetime-local` value ("2026-11-12T08:00") in `timeZone`. */
export function toLocalDateTimeInput(date: Date, timeZone: string): string {
  const w = wallParts(date.getTime(), timeZone)
  const pad = (n: number, len = 2) => String(n).padStart(len, '0')
  return `${pad(w.year, 4)}-${pad(w.month)}-${pad(w.day)}T${pad(w.hour)}:${pad(w.minute)}`
}

const pad2 = (n: number) => String(n).padStart(2, '0')

function utcMsOf(date: string): number {
  const [y, m, d] = date.split('-').map(Number)
  return Date.UTC(y, m - 1, d)
}

function dateOfUtcMs(ms: number): string {
  const d = new Date(ms)
  return `${String(d.getUTCFullYear()).padStart(4, '0')}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())}`
}

/** The local calendar date ("YYYY-MM-DD") of an instant in `timeZone`. */
export function localDateOf(at: Date, timeZone: string): string {
  const w = wallParts(at.getTime(), timeZone)
  return `${String(w.year).padStart(4, '0')}-${pad2(w.month)}-${pad2(w.day)}`
}

/**
 * The instant at `minute` minutes after local midnight of `date` ("YYYY-MM-DD") in `timeZone`.
 * `minute` runs 0-1440; 1440 is the next local midnight (the wall parser rejects hour 24, so it is
 * resolved as minute 0 of the following day).
 */
export function instantAt(date: string, minute: number, timeZone: string): Date {
  if (minute >= 1440) return instantAt(addDays(date, 1), minute - 1440, timeZone)
  const at = parseLocalDateTime(`${date}T${pad2(Math.floor(minute / 60))}:${pad2(minute % 60)}`, timeZone)
  if (!at) throw new RangeError(`Invalid local time: ${date} +${minute}min in ${timeZone}`)
  return at
}

/** Adds (or subtracts) whole calendar days to a "YYYY-MM-DD" date. */
export function addDays(date: string, days: number): string {
  return dateOfUtcMs(utcMsOf(date) + days * 86_400_000)
}

/** ISO weekday of a "YYYY-MM-DD" date: 1 = Monday ... 7 = Sunday. */
export function isoWeekday(date: string): number {
  const d = new Date(utcMsOf(date)).getUTCDay()
  return d === 0 ? 7 : d
}

/** The Monday ("YYYY-MM-DD") of the ISO week containing `date`. */
export function weekStartOf(date: string): string {
  return addDays(date, 1 - isoWeekday(date))
}
