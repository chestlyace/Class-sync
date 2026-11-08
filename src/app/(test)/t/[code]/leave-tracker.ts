// Pure and import-free: fed by the runner's visibility, focus and fullscreen listeners.

/**
 * What the page saw. `hidden`/`visible` come from `visibilitychange`, `blur`/`focus` from the
 * window, `fullscreen_exit`/`fullscreen_enter` from `fullscreenchange`, and `pagehide` when the tab
 * is closed or navigated away (some phones fire it without a `visibilitychange`).
 */
export type LeaveSignal = 'hidden' | 'visible' | 'blur' | 'focus' | 'fullscreen_exit' | 'fullscreen_enter' | 'pagehide'
export type LeaveEvent =
  | { type: 'left'; exitId: string; leftAtEpochMs: number }
  | { type: 'back'; exitId: string; awayMs: number }
/** An exit the student has not come back from; kept in localStorage so a closed tab is judged on reopening. */
export type OpenExit = { exitId: string; leftAtEpochMs: number }

/** Longest absence a report carries (a day); anything longer is far past any test's limit anyway. */
export const MAX_AWAY_MS = 86_400_000

/**
 * Blur and focus this soon after a full screen change are ignored: macOS can fire them while the
 * window moves into (or out of) full screen, which is not leaving. The runner reads the real focus
 * once the window has passed.
 */
export const FOCUS_QUIET_MS = 600

export type LeaveTrackerOptions = {
  /** Laptops: a window blur is leaving. Phones: false, the notification shade and call banners only take focus. */
  countsFocus: boolean
  /** Laptops that entered full screen with the Begin tap: leaving full screen is leaving until it is entered again. */
  countsFullscreen: boolean
  /** Epoch milliseconds (`Date.now`): absences span reloads, so the clock must too. */
  now: () => number
  newId: () => string
  /** The exit stored when the tab was closed, or null. */
  openExit: OpenExit | null
  /**
   * Leaving counts from the start. Otherwise (a fresh start, the student not yet on the questions)
   * signals only update the flags until `arm()` and the first moment the student is present.
   */
  armed: boolean
}

export type LeaveTracker = {
  /** Feeds one signal; returns the event it causes, if any. */
  handle(signal: LeaveSignal): LeaveEvent | null
  /** The student reached the questions: leaving counts from the first moment they are present. */
  arm(): void
  openExit(): OpenExit | null
}

/**
 * The student is away while any counted flag is set: the page is hidden, the window is unfocused
 * (when counted), or full screen was left (when counted). Going from present to away emits one
 * `left`, from away to present one `back`; every other signal only updates the flags. So the burst
 * a single switch fires (blur, visibilitychange, pagehide, in any order) is one exit, and so is its
 * return (visible, focus). Network state is not a signal: a lost connection is never leaving.
 *
 * Nothing counts before the student has been present on the questions (C1): a student in another
 * tab or app when the lecturer presses Start has not left a test they have not seen. Only a
 * reopened exit (a tab closed mid-test) counts from the start.
 */
export function createLeaveTracker(opts: LeaveTrackerOptions): LeaveTracker {
  // Reopened after closing the tab: the page was hidden when it closed, and stays away until it shows.
  let hidden = opts.openExit !== null
  let unfocused = false
  let outOfFullscreen = false
  let current: OpenExit | null = opts.openExit
  let armed = opts.armed || opts.openExit !== null
  let armRequested = armed
  let fullscreenChangedAt: number | null = null

  const away = () => hidden || (opts.countsFocus && unfocused) || (opts.countsFullscreen && outOfFullscreen)

  function apply(signal: LeaveSignal) {
    switch (signal) {
      case 'hidden':
      case 'pagehide':
        hidden = true
        break
      case 'visible':
        hidden = false
        break
      case 'blur':
        unfocused = true
        break
      case 'focus':
        unfocused = false
        break
      case 'fullscreen_exit':
        outOfFullscreen = true
        break
      case 'fullscreen_enter':
        outOfFullscreen = false
        break
    }
  }

  const inQuietWindow = (signal: LeaveSignal) =>
    (signal === 'blur' || signal === 'focus') &&
    fullscreenChangedAt !== null &&
    opts.now() - fullscreenChangedAt < FOCUS_QUIET_MS

  return {
    handle(signal) {
      if (inQuietWindow(signal)) return null
      if (signal === 'fullscreen_enter' || signal === 'fullscreen_exit') fullscreenChangedAt = opts.now()
      apply(signal)
      if (!armed) {
        if (armRequested && !away()) armed = true
        return null
      }
      if (away() && current === null) {
        current = { exitId: opts.newId(), leftAtEpochMs: opts.now() }
        return { type: 'left', ...current }
      }
      if (!away() && current !== null) {
        const awayMs = Math.min(MAX_AWAY_MS, Math.max(0, Math.round(opts.now() - current.leftAtEpochMs)))
        const back: LeaveEvent = { type: 'back', exitId: current.exitId, awayMs }
        current = null
        return back
      }
      return null
    },
    arm() {
      armRequested = true
      if (!armed && !away()) armed = true
    },
    openExit: () => current,
  }
}
