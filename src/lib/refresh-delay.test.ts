import { describe, expect, it } from 'vitest'
import { refreshDelayMs } from './refresh-delay'

describe('refreshDelayMs', () => {
  it('waits until just after the moment, on the server clock', () => {
    expect(refreshDelayMs('2026-11-09T10:42:00Z', '2026-11-09T10:40:00Z')).toBe(121_500)
    expect(refreshDelayMs(new Date('2026-11-09T10:42:00Z'), new Date('2026-11-09T10:41:59Z'))).toBe(2500)
  })

  it('never refreshes in a tight loop when the moment has passed', () => {
    expect(refreshDelayMs('2026-11-09T10:42:00Z', '2026-11-09T10:45:00Z')).toBe(1000)
  })

  it('stays within what a timer can wait, and is safe with a bad date', () => {
    expect(refreshDelayMs('2027-11-09T10:42:00Z', '2026-11-09T10:42:00Z')).toBe(2 ** 31 - 1)
    expect(refreshDelayMs('nope', '2026-11-09T10:42:00Z')).toBe(2 ** 31 - 1)
  })
})
