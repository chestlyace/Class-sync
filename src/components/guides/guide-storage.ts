/**
 * What the guide runner (in the layout) and the Help button (in the nav) share, without a React
 * context around the page: a context provider there would re-render into the page's streaming
 * Suspense boundaries while they hydrate. Browser-only; every read tolerates missing storage.
 */

/** localStorage, per user: guides finished or closed, which don't start by themselves again. */
const seenKey = (userId: string) => `clasync:guides-seen:${userId}`
/** localStorage "1": never start a guide by itself on this device (set by the end-to-end tests). */
export const GUIDES_OFF_KEY = 'clasync:guides-off'
/** Window event asking the runner to start a guide; `detail` is the guide id. */
const START_EVENT = 'clasync:guide-start'

export function readSeen(userId: string): Set<string> {
  try {
    const raw = window.localStorage.getItem(seenKey(userId))
    const list: unknown = raw ? JSON.parse(raw) : []
    return new Set(Array.isArray(list) ? list.filter((x): x is string => typeof x === 'string') : [])
  } catch {
    return new Set()
  }
}

export function addSeen(userId: string, guideId: string): void {
  try {
    const seen = readSeen(userId).add(guideId)
    window.localStorage.setItem(seenKey(userId), JSON.stringify([...seen]))
  } catch {
    // Private mode or full storage: the guide may start by itself again next visit.
  }
}

export function guidesOff(): boolean {
  try {
    return window.localStorage.getItem(GUIDES_OFF_KEY) === '1'
  } catch {
    return false
  }
}

export function requestGuide(guideId: string): void {
  window.dispatchEvent(new CustomEvent<string>(START_EVENT, { detail: guideId }))
}

export function onGuideRequest(listener: (guideId: string) => void): () => void {
  const handler = (e: Event) => {
    if (e instanceof CustomEvent && typeof e.detail === 'string') listener(e.detail)
  }
  window.addEventListener(START_EVENT, handler)
  return () => window.removeEventListener(START_EVENT, handler)
}
