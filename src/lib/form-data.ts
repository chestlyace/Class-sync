import { AppError } from '@/server/core/errors'

/** A text field from a submitted form; '' when missing (or not text). Services validate the value. */
export function formString(data: FormData, key: string): string {
  const value = data.get(key)
  return typeof value === 'string' ? value : ''
}

/** An optional numeric field (latitude/longitude): blank → undefined, junk → VALIDATION. */
export function optionalCoordinate(data: FormData, key: string): number | undefined {
  const raw = formString(data, key).trim()
  if (raw === '') return undefined
  const value = Number(raw)
  if (!Number.isFinite(value)) throw new AppError('VALIDATION', 'Invalid input', { fields: [key] })
  return value
}
