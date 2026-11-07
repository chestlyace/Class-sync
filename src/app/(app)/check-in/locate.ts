import type { Position } from '@/server/attendance/geo'

/** How long the geolocation API's own timeout waits for a fix once the prompt is answered. */
export const LOCATE_TIMEOUT_MS = 15_000
/**
 * Our own deadline. The API's timeout only starts after the permission prompt is answered, and
 * an ignored or dismissed prompt (Firefox's "Not now") never calls back: without this the form
 * would wait forever. Past it we send null and the server answers `location_required`.
 */
export const LOCATE_FALLBACK_MS = 20_000

/** One position fix; null without geolocation, on denial, on timeout, or when the prompt is ignored. */
export function locate(geolocation: Geolocation | undefined): Promise<Position | null> {
  return new Promise((resolve) => {
    if (!geolocation) return resolve(null)
    let done = false
    const finish = (value: Position | null) => {
      if (done) return
      done = true
      clearTimeout(fallback)
      resolve(value)
    }
    const fallback = setTimeout(() => finish(null), LOCATE_FALLBACK_MS)
    geolocation.getCurrentPosition(
      ({ coords }) => finish({ latitude: coords.latitude, longitude: coords.longitude, accuracy: coords.accuracy }),
      () => finish(null),
      { enableHighAccuracy: true, timeout: LOCATE_TIMEOUT_MS, maximumAge: 0 },
    )
  })
}

export type Locator = {
  /** Starts the position request early (e.g. when the code input gets focus), once. */
  warm(): void
  /**
   * The position to send with a check-in. Reuses the early request: waits for it while it is
   * pending, and reuses its fix. When it already ended without a position (denied, ignored,
   * timed out) before this submit, asks once more: the student may have allowed it since.
   */
  position(): Promise<Position | null>
}

/** Starts the location fix while the student types the code, so the code doesn't expire meanwhile. */
export function createLocator(getGeolocation: () => Geolocation | undefined): Locator {
  let attempt: { promise: Promise<Position | null>; settled: boolean; value: Position | null } | null = null

  function start() {
    const current = { promise: locate(getGeolocation()), settled: false, value: null as Position | null }
    current.promise.then((value) => {
      current.settled = true
      current.value = value
    })
    attempt = current
    return current
  }

  return {
    warm() {
      if (!attempt) start()
    },
    position() {
      if (!attempt || (attempt.settled && attempt.value === null)) return start().promise
      return attempt.promise
    },
  }
}
