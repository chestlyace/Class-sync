import { describe, expect, it } from 'vitest'
import { checkCampus, distanceMeters } from './geo'

const campus = { latitude: 4.1527, longitude: 9.241, radiusM: 500 }
const north = (deg: number, accuracy: number) => ({
  latitude: 4.1527 + deg,
  longitude: 9.241,
  accuracy,
})

describe('geo', () => {
  it('haversine distance', () =>
    expect(Math.round(distanceMeters(campus, north(0.0027, 0)))).toBe(300))

  it('inside the radius is ok', () => expect(checkCampus(north(0.0027, 20), campus)).toBe('ok'))

  it('accuracy allowance lets a nearby fix through', () =>
    expect(checkCampus(north(0.0054, 150), campus)).toBe('ok'))

  it('outside the radius is off_campus', () =>
    expect(checkCampus(north(0.0072, 100), campus)).toBe('off_campus'))

  it('allowance is capped at 150 m', () =>
    expect(checkCampus(north(0.0072, 900), campus)).toBe('off_campus'))

  it('too imprecise a fix is rejected', () =>
    expect(checkCampus(north(0, 1200), campus)).toBe('location_imprecise'))

  it('missing position is location_required', () =>
    expect(checkCampus(null, campus)).toBe('location_required'))
})
