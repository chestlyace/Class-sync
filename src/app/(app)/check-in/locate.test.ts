import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { LOCATE_FALLBACK_MS, locate } from './locate'

type Success = (p: { coords: { latitude: number; longitude: number; accuracy: number } }) => void

function fakeGeolocation(behaviour: (success: Success, error: () => void) => void) {
  return { getCurrentPosition: vi.fn(behaviour) } as unknown as Geolocation
}

describe('locate', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it('resolves the position from a fix', async () => {
    const geo = fakeGeolocation((success) => success({ coords: { latitude: 4.05, longitude: 9.7, accuracy: 20 } }))
    await expect(locate(geo)).resolves.toEqual({ latitude: 4.05, longitude: 9.7, accuracy: 20 })
    expect(vi.getTimerCount()).toBe(0) // the fallback timer is cleared
  })

  it('resolves null when the prompt is denied', async () => {
    const geo = fakeGeolocation((_success, error) => error())
    await expect(locate(geo)).resolves.toBeNull()
    expect(vi.getTimerCount()).toBe(0)
  })

  it('resolves null without geolocation', async () => {
    await expect(locate(undefined)).resolves.toBeNull()
  })

  it('resolves null after the fallback when the prompt is never answered', async () => {
    const geo = fakeGeolocation(() => {}) // ignored prompt: no callback, ever
    let settled: unknown = 'pending'
    void locate(geo).then((value) => (settled = value))
    await vi.advanceTimersByTimeAsync(LOCATE_FALLBACK_MS - 1)
    expect(settled).toBe('pending')
    await vi.advanceTimersByTimeAsync(1)
    expect(settled).toBeNull()
  })

  it('ignores a late callback after the fallback', async () => {
    let late: Success | undefined
    const geo = fakeGeolocation((success) => (late = success))
    const result = locate(geo)
    await vi.advanceTimersByTimeAsync(LOCATE_FALLBACK_MS)
    late?.({ coords: { latitude: 1, longitude: 2, accuracy: 3 } })
    await expect(result).resolves.toBeNull()
  })
})
