const UNIQUE_VIOLATION = '23505'

type PgErrorLike = { code?: unknown; constraint?: unknown; cause?: unknown }

/**
 * True when `err` is a Postgres unique violation (SQLSTATE 23505). Drizzle wraps driver
 * errors, so the Postgres error may sit on `err.cause`; the chain is walked either way
 * (works for both node-postgres and PGlite). Pass `constraint` to match one specific
 * unique constraint by name.
 */
export function isUniqueViolation(err: unknown, constraint?: string): boolean {
  let current: unknown = err
  for (let depth = 0; depth < 5 && typeof current === 'object' && current !== null; depth++) {
    const e = current as PgErrorLike
    if (e.code === UNIQUE_VIOLATION && (constraint === undefined || e.constraint === constraint)) {
      return true
    }
    current = e.cause
  }
  return false
}
