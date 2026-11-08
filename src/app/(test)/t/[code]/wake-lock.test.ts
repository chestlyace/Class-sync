import { describe, expect, it, vi } from 'vitest'
import { createWakeLockKeeper, wantsWakeLock, type WakeLockSentinelLike } from './wake-lock'

function fakeSentinel(): WakeLockSentinelLike & { release: ReturnType<typeof vi.fn> } {
  const s = {
    released: false,
    release: vi.fn(async () => {
      s.released = true
    }),
  }
  return s
}

describe('wantsWakeLock (the re-request trigger)', () => {
  it('asks while answering and visible, unless a lock is held or already asked for', () => {
    expect(wantsWakeLock({ active: true, visible: true, held: false, pending: false })).toBe(true)
    expect(wantsWakeLock({ active: true, visible: true, held: true, pending: false })).toBe(false)
    expect(wantsWakeLock({ active: true, visible: true, held: false, pending: true })).toBe(false)
    expect(wantsWakeLock({ active: true, visible: false, held: false, pending: false })).toBe(false)
    expect(wantsWakeLock({ active: false, visible: true, held: false, pending: false })).toBe(false)
  })
})

describe('createWakeLockKeeper', () => {
  it('does nothing where the API is missing', async () => {
    const keeper = createWakeLockKeeper(null)
    await keeper.refresh(true)
    keeper.release()
  })

  it('takes the lock once, and again after the browser released it (the page was hidden)', async () => {
    const sentinels: ReturnType<typeof fakeSentinel>[] = []
    const request = vi.fn(async () => {
      const s = fakeSentinel()
      sentinels.push(s)
      return s
    })
    const keeper = createWakeLockKeeper(request)
    await keeper.refresh(true)
    await keeper.refresh(true)
    expect(request).toHaveBeenCalledTimes(1)

    sentinels[0].released = true // hidden: the browser drops the lock
    await keeper.refresh(false)
    expect(request).toHaveBeenCalledTimes(1)
    await keeper.refresh(true) // visible again (visibilitychange or pageshow)
    expect(request).toHaveBeenCalledTimes(2)

    keeper.release()
    expect(sentinels[1].release).toHaveBeenCalledTimes(1)
    await keeper.refresh(true)
    expect(request).toHaveBeenCalledTimes(2)
  })

  it('a refusal is silent and a later refresh tries again', async () => {
    const request = vi.fn().mockRejectedValueOnce(new Error('NotAllowedError')).mockResolvedValue(fakeSentinel())
    const keeper = createWakeLockKeeper(request)
    await expect(keeper.refresh(true)).resolves.toBeUndefined()
    await keeper.refresh(true)
    expect(request).toHaveBeenCalledTimes(2)
  })

  it('a lock granted after release() is let go at once', async () => {
    const late = fakeSentinel()
    let grant: (s: WakeLockSentinelLike) => void = () => {}
    const keeper = createWakeLockKeeper(() => new Promise((resolve) => (grant = resolve)))
    const asked = keeper.refresh(true)
    keeper.release()
    grant(late)
    await asked
    expect(late.release).toHaveBeenCalledTimes(1)
  })
})
