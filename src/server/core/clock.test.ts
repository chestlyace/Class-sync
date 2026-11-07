import { afterEach, describe, expect, it } from 'vitest'
import { now, setNowForTests } from './clock'

afterEach(() => setNowForTests(null))

describe('clock', () => {
  it('returns the test override while set', () => {
    const fixed = new Date('2026-11-09T08:00:00Z')
    setNowForTests(() => fixed)
    expect(now()).toBe(fixed)
  })

  it('returns real time after the override is cleared', () => {
    setNowForTests(() => new Date(0))
    setNowForTests(null)
    expect(Math.abs(now().getTime() - Date.now())).toBeLessThan(1000)
  })
})
