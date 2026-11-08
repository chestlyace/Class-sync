/** setTimeout's largest delay (about 24.8 days); anything later is never reached on one page. */
const MAX_TIMEOUT_MS = 2 ** 31 - 1
/** A little after the moment, so the server is surely past it; never sooner than this. */
const AFTER_MS = 1500
const MIN_MS = 1000

/**
 * How long until a page should refresh to show what changes at `at`, measured on the server's
 * clock (`serverNow`, when the page was rendered), so a device clock that is off does not refresh
 * too early, in a loop, or never.
 */
export function refreshDelayMs(at: string | Date, serverNow: string | Date): number {
  const delay = new Date(at).getTime() - new Date(serverNow).getTime() + AFTER_MS
  if (!Number.isFinite(delay)) return MAX_TIMEOUT_MS
  return Math.min(MAX_TIMEOUT_MS, Math.max(MIN_MS, delay))
}
