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
