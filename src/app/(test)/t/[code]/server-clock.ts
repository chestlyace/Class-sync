/**
 * The device clock can be minutes off, so the countdown runs on server time: each sync returns the
 * server's "now", and the offset is that minus the middle of the request (half the round trip is
 * assumed on each side). All times are epoch milliseconds (`Date.now()`).
 */

/** Server time minus device time at the request's midpoint; 0 when the server time is unreadable. */
export function clockOffsetMs(serverNowIso: string, sentAtMs: number, receivedAtMs: number): number {
  const serverNow = Date.parse(serverNowIso)
  const offset = Math.round(serverNow - (sentAtMs + receivedAtMs) / 2)
  return Number.isFinite(offset) ? offset + 0 : 0 // + 0 turns -0 into 0
}

/** Time left until the server deadline, never below 0 (0 also for an unreadable deadline). */
export function msLeft(endsAtIso: string, offsetMs: number, nowMs: number): number {
  const left = Date.parse(endsAtIso) - (nowMs + offsetMs)
  return Number.isFinite(left) ? Math.max(0, left) : 0
}
