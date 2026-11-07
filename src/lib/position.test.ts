import { describe, expect, it } from 'vitest'
import { parsePosition } from './position'

describe('parsePosition', () => {
  it('returns the position for three finite numbers', () => {
    expect(parsePosition({ latitude: 4.05, longitude: 9.7, accuracy: 25 })).toEqual({
      latitude: 4.05,
      longitude: 9.7,
      accuracy: 25,
    })
  })

  it('keeps only the three coordinates', () => {
    expect(parsePosition({ latitude: 1, longitude: 2, accuracy: 3, altitude: 4, extra: 'x' })).toEqual({
      latitude: 1,
      longitude: 2,
      accuracy: 3,
    })
  })

  it('returns null for null, undefined and non-objects', () => {
    expect(parsePosition(null)).toBeNull()
    expect(parsePosition(undefined)).toBeNull()
    expect(parsePosition('4.05,9.7')).toBeNull()
    expect(parsePosition(42)).toBeNull()
    expect(parsePosition([4.05, 9.7, 25])).toBeNull()
  })

  it('returns null when a coordinate is a string', () => {
    expect(parsePosition({ latitude: '4.05', longitude: 9.7, accuracy: 25 })).toBeNull()
  })

  it('returns null for NaN or infinite values', () => {
    expect(parsePosition({ latitude: Number.NaN, longitude: 9.7, accuracy: 25 })).toBeNull()
    expect(parsePosition({ latitude: 4.05, longitude: Infinity, accuracy: 25 })).toBeNull()
  })

  it('returns null when accuracy is missing', () => {
    expect(parsePosition({ latitude: 4.05, longitude: 9.7 })).toBeNull()
  })
})
