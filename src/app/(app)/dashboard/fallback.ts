import { unstable_rethrow } from 'next/navigation'

/**
 * A secondary list on a page (e.g. the dashboard's open check-ins): if it fails to load, the page
 * still renders without it. The failure is logged server-side. Next's own control-flow errors
 * (redirect, notFound, dynamic rendering bail-outs) are rethrown, never swallowed.
 */
export async function orEmptyOnError<T>(what: string, load: () => Promise<T[]>): Promise<T[]> {
  try {
    return await load()
  } catch (err) {
    unstable_rethrow(err)
    console.error(`[dashboard] ${what} failed to load`, err)
    return []
  }
}
