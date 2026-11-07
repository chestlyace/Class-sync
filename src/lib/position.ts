import type { Position } from '@/server/attendance/geo'

const isFiniteNumber = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v)

/**
 * A position sent by the browser, or null when it is anything other than three finite numbers
 * (no fix, a denied prompt, or a tampered payload). The service checks the ranges.
 */
export function parsePosition(value: unknown): Position | null {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return null
  const { latitude, longitude, accuracy } = value as Record<string, unknown>
  if (!isFiniteNumber(latitude) || !isFiniteNumber(longitude) || !isFiniteNumber(accuracy)) return null
  return { latitude, longitude, accuracy }
}
