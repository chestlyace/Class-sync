import { AppError } from '@/server/core/errors'

/**
 * A text field from a submitted form; '' when missing (or not text). Services validate the value.
 * `data` may be absent: a malformed or stale Server Action request can invoke an action without a
 * FormData body, and that must reach the service's VALIDATION error, not throw here as a 500.
 */
export function formString(data: FormData | null | undefined, key: string): string {
  if (!data || typeof data.get !== 'function') return ''
  const value = data.get(key)
  return typeof value === 'string' ? value : ''
}

/** An optional numeric field (latitude/longitude): blank → undefined, junk → VALIDATION. */
export function optionalCoordinate(data: FormData | null | undefined, key: string): number | undefined {
  const raw = formString(data, key).trim()
  if (raw === '') return undefined
  const value = Number(raw)
  if (!Number.isFinite(value)) throw new AppError('VALIDATION', 'Invalid input', { fields: [key] })
  return value
}
