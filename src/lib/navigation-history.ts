/** sessionStorage keys for the last two in-app pages the signed-in layout has seen. */
export const CURRENT_PAGE_KEY = 'clasync:current-page'
export const PREVIOUS_PAGE_KEY = 'clasync:previous-page'
export const PAGE_HISTORY_EVENT = 'clasync:page-history'

export type PageHistory = { current: string | null; previous: string | null }

function pathOf(url: string): string {
  return url.split(/[?#]/, 1)[0]
}

/**
 * Records a visit to `url`. A refresh or a query/hash-only change keeps the previous page; a real
 * navigation moves the old current page into `previous`.
 */
export function visitPage(history: PageHistory, url: string): { current: string; previous: string | null } {
  if (!history.current || pathOf(history.current) === pathOf(url)) return { current: url, previous: history.previous }
  return { current: url, previous: history.current }
}
