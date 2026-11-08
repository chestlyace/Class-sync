// Pure apart from the injected request: the runner passes `navigator.wakeLock.request('screen')`.

/** The part of `WakeLockSentinel` the keeper uses. */
export type WakeLockSentinelLike = { released: boolean; release(): Promise<void> }
export type RequestWakeLock = () => Promise<WakeLockSentinelLike>

/**
 * Whether to ask for the screen lock now: while answering and visible, with none held or asked for.
 * The browser drops the lock whenever the page hides, so it is asked for again on each return
 * (`visibilitychange` to visible, `pageshow`).
 */
export function wantsWakeLock(s: { active: boolean; visible: boolean; held: boolean; pending: boolean }): boolean {
  return s.active && s.visible && !s.held && !s.pending
}

export type WakeLockKeeper = {
  /** Asks for the lock if it is wanted now. Never throws: a refusal or a missing API is silent. */
  refresh(visible: boolean): Promise<void>
  /** Lets the lock go for good (answering is over). */
  release(): void
}

/**
 * Keeps the screen on while answering (C2): a phone that locks itself after 30 s of reading would
 * otherwise count as leaving. Locking the phone by hand still counts. `request` is null where the
 * Screen Wake Lock API is missing; the waiting screen asks students to keep the screen on.
 */
export function createWakeLockKeeper(request: RequestWakeLock | null): WakeLockKeeper {
  let sentinel: WakeLockSentinelLike | null = null
  let pending = false
  let active = true

  return {
    async refresh(visible) {
      if (!request) return
      const held = sentinel !== null && !sentinel.released
      if (!wantsWakeLock({ active, visible, held, pending })) return
      pending = true
      try {
        const granted = await request()
        if (active) sentinel = granted
        else void granted.release().catch(() => {})
      } catch {
        // Refused (battery saver, no user activation yet, not supported): the screen may lock.
      } finally {
        pending = false
      }
    },
    release() {
      active = false
      if (sentinel && !sentinel.released) void sentinel.release().catch(() => {})
      sentinel = null
    },
  }
}
