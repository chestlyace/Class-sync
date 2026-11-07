import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createLocator, LOCATE_FALLBACK_MS, locate } from './locate'

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

describe('createLocator', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  const FIX = { coords: { latitude: 4.05, longitude: 9.7, accuracy: 20 } }

  it('warm() starts one request early and position() reuses it while it is pending', async () => {
    let answer: Success | undefined
    const geo = fakeGeolocation((success) => (answer = success))
    const locator = createLocator(() => geo)
    locator.warm()
    locator.warm() // focusing again does not ask twice
    expect(geo.getCurrentPosition).toHaveBeenCalledTimes(1)

    const position = locator.position()
    expect(geo.getCurrentPosition).toHaveBeenCalledTimes(1)
    answer?.(FIX)
    await expect(position).resolves.toEqual({ latitude: 4.05, longitude: 9.7, accuracy: 20 })
  })

  it('the first position() reuses the warm-up fix; the next submit starts a new request', async () => {
    const geo = fakeGeolocation((success) => success(FIX))
    const locator = createLocator(() => geo)
    locator.warm()
    await vi.advanceTimersByTimeAsync(0)
    await expect(locator.position()).resolves.toEqual({ latitude: 4.05, longitude: 9.7, accuracy: 20 })
    expect(geo.getCurrentPosition).toHaveBeenCalledTimes(1)

    await expect(locator.position()).resolves.toEqual({ latitude: 4.05, longitude: 9.7, accuracy: 20 })
    expect(geo.getCurrentPosition).toHaveBeenCalledTimes(2)
  })

  it('after a refusal (off campus), resubmitting sends the new position, not the cached one', async () => {
    const fixes = [
      { coords: { latitude: 4.1707, longitude: 9.241, accuracy: 20 } }, // 2 km away
      { coords: { latitude: 4.1527, longitude: 9.241, accuracy: 15 } }, // walked onto campus
    ]
    let calls = 0
    const geo = fakeGeolocation((success) => success(fixes[calls++]))
    const locator = createLocator(() => geo)
    locator.warm() // focus
    // First submit: the server refuses it (off_campus); the form stays mounted.
    await expect(locator.position()).resolves.toEqual({ latitude: 4.1707, longitude: 9.241, accuracy: 20 })
    // Second submit after moving: a fresh request with the new position.
    await expect(locator.position()).resolves.toEqual({ latitude: 4.1527, longitude: 9.241, accuracy: 15 })
    expect(geo.getCurrentPosition).toHaveBeenCalledTimes(2)
    // Every request asks for a fresh fix, never a cached one.
    for (const call of vi.mocked(geo.getCurrentPosition).mock.calls) expect(call[2]).toMatchObject({ maximumAge: 0 })
  })

  it('focusing again after a submit warms up a fresh request that the next submit uses', async () => {
    const geo = fakeGeolocation((success) => success(FIX))
    const locator = createLocator(() => geo)
    locator.warm()
    await locator.position()
    locator.warm() // the student taps the input to type the code again
    expect(geo.getCurrentPosition).toHaveBeenCalledTimes(2)
    await locator.position()
    expect(geo.getCurrentPosition).toHaveBeenCalledTimes(2)
  })

  it('position() without warm() asks once', async () => {
    const geo = fakeGeolocation((success) => success(FIX))
    const locator = createLocator(() => geo)
    await expect(locator.position()).resolves.toEqual({ latitude: 4.05, longitude: 9.7, accuracy: 20 })
    expect(geo.getCurrentPosition).toHaveBeenCalledTimes(1)
  })

  it('a submit retries once when the early request already ended without a position', async () => {
    let calls = 0
    const geo = fakeGeolocation((success, error) => (++calls === 1 ? error() : success(FIX)))
    const locator = createLocator(() => geo)
    locator.warm()
    await vi.advanceTimersByTimeAsync(0) // denied before the submit
    locator.warm() // focusing again does not re-prompt
    expect(geo.getCurrentPosition).toHaveBeenCalledTimes(1)

    await expect(locator.position()).resolves.toEqual({ latitude: 4.05, longitude: 9.7, accuracy: 20 })
    expect(geo.getCurrentPosition).toHaveBeenCalledTimes(2)
  })

  it('a submit while the early request is pending waits for it and does not retry when it ends null', async () => {
    let deny: (() => void) | undefined
    const geo = fakeGeolocation((_success, error) => (deny = error))
    const locator = createLocator(() => geo)
    locator.warm()
    const position = locator.position()
    deny?.()
    await expect(position).resolves.toBeNull()
    expect(geo.getCurrentPosition).toHaveBeenCalledTimes(1)
  })

  it('keeps the fallback: an ignored prompt ends null after LOCATE_FALLBACK_MS', async () => {
    const geo = fakeGeolocation(() => {})
    const locator = createLocator(() => geo)
    locator.warm()
    let settled: unknown = 'pending'
    void locator.position().then((value) => (settled = value))
    await vi.advanceTimersByTimeAsync(LOCATE_FALLBACK_MS - 1)
    expect(settled).toBe('pending')
    await vi.advanceTimersByTimeAsync(1)
    expect(settled).toBeNull()
  })

  it('without geolocation it resolves null', async () => {
    const locator = createLocator(() => undefined)
    locator.warm()
    await expect(locator.position()).resolves.toBeNull()
  })
})
