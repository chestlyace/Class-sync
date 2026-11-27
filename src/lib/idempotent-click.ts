/** Repeat taps inside this window are treated as the click already in flight. */
export const CLICK_COOLDOWN_MS = 2000

/** The parts of a React mouse event the click gate needs. */
export type ClickLike = {
  button: number
  metaKey: boolean
  ctrlKey: boolean
  shiftKey: boolean
  altKey: boolean
}

/**
 * Claims a plain left click for one action. Modifier and non-primary clicks are deliberate
 * (new tab, context menu), so they pass through without consuming the cooldown.
 * `gate` is mutable so a component can keep it in a ref across re-renders.
 */
export function claimClick(
  event: ClickLike,
  now: number,
  gate: { until: number },
  cooldownMs = CLICK_COOLDOWN_MS,
): boolean {
  if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return true
  if (now < gate.until) return false
  gate.until = now + cooldownMs
  return true
}
