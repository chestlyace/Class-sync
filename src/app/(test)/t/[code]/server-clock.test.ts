import { describe, expect, it } from 'vitest'
import { clockOffsetMs, msLeft } from './server-clock'

const T = Date.parse('2026-11-09T08:00:00.000Z')

describe('clockOffsetMs', () => {
  it('is the server time minus the middle of the request', () => {
    expect(clockOffsetMs('2026-11-09T08:00:10.000Z', T, T + 2000)).toBe(Date.parse('2026-11-09T08:00:10Z') - (T + 1000))
  })

  it('is negative when the device clock runs ahead', () => {
    expect(clockOffsetMs('2026-11-09T08:00:00.000Z', T + 60_000, T + 60_000)).toBe(-60_000)
  })

  it('is a whole number of milliseconds', () => {
    expect(clockOffsetMs('2026-11-09T08:00:00.000Z', T, T + 3)).toBe(-1)
    expect(clockOffsetMs('2026-11-09T08:00:00.000Z', T, T + 1)).toBe(0) // not -0
  })

  it('is 0 for an unreadable server time', () => {
    expect(clockOffsetMs('soon', T, T + 10)).toBe(0)
  })
})

describe('msLeft', () => {
  const endsAt = '2026-11-09T09:00:00.000Z'

  it('counts down to the server deadline using the offset', () => {
    expect(msLeft(endsAt, 0, Date.parse(endsAt) - 60_000)).toBe(60_000)
    // device clock 30 s behind the server: offset +30 s, so 30 s less is left
    expect(msLeft(endsAt, 30_000, Date.parse(endsAt) - 60_000)).toBe(30_000)
  })

  it('never goes below 0', () => {
    expect(msLeft(endsAt, 0, Date.parse(endsAt) + 5)).toBe(0)
    expect(msLeft(endsAt, 0, Date.parse(endsAt))).toBe(0)
  })

  it('is 0 for an unreadable deadline', () => {
    expect(msLeft('later', 0, T)).toBe(0)
  })
})
