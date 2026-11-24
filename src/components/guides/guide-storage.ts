/**
 * What the guide runner (in the layout) and the Guides list (in Settings) share, without a React
 * context around the page: a context provider there would re-render into the page's streaming
 * Suspense boundaries while they hydrate. Browser-only; every read tolerates missing storage.
 * Which guides were seen is kept on the account (src/server/guides), not here.
 */

/** localStorage "1": never start a guide by itself on this device (set by the end-to-end tests). */
export const GUIDES_OFF_KEY = 'clasync:guides-off'
/** Window event asking the runner to start a guide; `detail` is the guide id. */
const START_EVENT = 'clasync:guide-start'

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
