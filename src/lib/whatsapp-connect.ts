/** How often the page asks whether the WhatsApp message arrived. */
export const POLL_MS = 3000
/** Stop waiting after this long (the connect code lasts the same time). */
export const POLL_LIMIT_MS = 15 * 60_000

/**
 * What to do with one answer from the server while waiting for the WhatsApp message.
 * The answer always comes first: a tab that slept in the background past the limit may well be
 * connected already, so "expired" only counts when the server still shows no number.
 */
export function pollOutcome(input: {
  phone: string | null
  startedAt: number
  now: number
  limitMs?: number
}): 'connected' | 'expired' | 'waiting' {
  if (input.phone) return 'connected'
  return input.now - input.startedAt >= (input.limitMs ?? POLL_LIMIT_MS) ? 'expired' : 'waiting'
}
