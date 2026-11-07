import { ACCURACY_ALLOWANCE_CAP_M, MAX_LOCATION_ACCURACY_M } from './rules'

export type Position = { latitude: number; longitude: number; accuracy: number }
export type Campus = { latitude: number; longitude: number; radiusM: number }

const EARTH_RADIUS_M = 6_371_000
const toRad = (deg: number) => (deg * Math.PI) / 180

/** Great-circle distance in metres (haversine). */
export function distanceMeters(
  a: { latitude: number; longitude: number },
  b: { latitude: number; longitude: number },
): number {
  const dLat = toRad(b.latitude - a.latitude)
  const dLon = toRad(b.longitude - a.longitude)
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.latitude)) * Math.cos(toRad(b.latitude)) * Math.sin(dLon / 2) ** 2
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h)))
}

/**
 * Is the position on campus? The fix's reported accuracy is forgiven against the radius,
 * but only up to a cap, so a vague fix cannot reach far beyond the boundary.
 */
export function checkCampus(
  position: Position | null,
  campus: Campus,
): 'ok' | 'location_required' | 'location_imprecise' | 'off_campus' {
  if (!position) return 'location_required'
  if (position.accuracy > MAX_LOCATION_ACCURACY_M) return 'location_imprecise'
  const allowance = Math.min(Math.max(position.accuracy, 0), ACCURACY_ALLOWANCE_CAP_M)
  return distanceMeters(position, campus) - allowance <= campus.radiusM ? 'ok' : 'off_campus'
}
