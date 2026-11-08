import type { ActionResult } from '@/lib/action-result'

/** A request still unanswered after this is given up on (aborted) and treated as no connection. */
export const REQUEST_TIMEOUT_MS = 15_000

/**
 * The answer to one call: the route's `ActionResult`, `offline` (no connection, cut, or no answer
 * within the timeout) or `failed` (the server broke: a 5xx or a body that is not a result).
 */
export type CallOutcome<T> = ActionResult<T> | 'offline' | 'failed'

function isResult(value: unknown): value is ActionResult<unknown> {
  if (typeof value !== 'object' || value === null) return false
  const v = value as { ok?: unknown; code?: unknown }
  return v.ok === true ? 'data' in v : v.ok === false && typeof v.code === 'string'
}

/**
 * POSTs JSON to one of the runner's routes with a deadline (I3). Unlike a Server Action, which a
 * client runs one at a time, a stuck request here holds up nothing else, and it is aborted after
 * `timeoutMs`: the runner then shows the quiet offline line and retries, never a leave warning.
 * `signal` aborts it early (the runner unmounted). Never throws.
 */
export async function postJson<T>(
  url: string,
  body: unknown,
  opts: { timeoutMs?: number; signal?: AbortSignal; fetchImpl?: typeof fetch } = {},
): Promise<CallOutcome<T>> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), opts.timeoutMs ?? REQUEST_TIMEOUT_MS)
  const onAbort = () => controller.abort()
  opts.signal?.addEventListener('abort', onAbort)
  if (opts.signal?.aborted) controller.abort()
  try {
    const res = await (opts.fetchImpl ?? fetch)(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
      credentials: 'same-origin',
      cache: 'no-store',
      signal: controller.signal,
    })
    let parsed: unknown
    try {
      // Reading the body is under the same deadline (the abort cuts a stalled body too).
      parsed = await res.json()
    } catch {
      // Cut while reading (timeout or no connection), or not JSON at all (a proxy's error page).
      return controller.signal.aborted ? 'offline' : 'failed'
    }
    return isResult(parsed) ? (parsed as ActionResult<T>) : 'failed'
  } catch {
    // A network error, or aborted by the timeout or the caller.
    return 'offline'
  } finally {
    clearTimeout(timer)
    opts.signal?.removeEventListener('abort', onAbort)
  }
}
