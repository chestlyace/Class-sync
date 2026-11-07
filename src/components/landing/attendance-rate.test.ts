import { describe, expect, it } from 'vitest'
import { attendanceRate } from './attendance-rate'

describe('attendanceRate', () => {
  it('is 1 when every session is present', () => {
    expect(attendanceRate(['P', 'P', 'P', 'P'])).toBe(1)
  })

  it('counts a partial as half a session', () => {
    expect(attendanceRate(['P', 'H', 'P', 'P'])).toBe(0.875)
  })

  it('counts an absence as nothing', () => {
    expect(attendanceRate(['A', 'H', 'A', 'P'])).toBe(0.375)
  })

  it('is 0 when there are no sessions', () => {
    expect(attendanceRate([])).toBe(0)
  })
})
