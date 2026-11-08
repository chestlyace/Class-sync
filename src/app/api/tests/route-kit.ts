import { toActionResult, type ActionResult } from '@/lib/action-result'
import { AppError, type ErrorCode } from '@/server/core/errors'

/**
 * What the tests' JSON Route Handlers share. They are Route Handlers, not Server Actions, because
 * a client runs its Server Actions one at a time: one request stuck on a weak connection would
 * hold up every later one. The body is an `ActionResult`, with an HTTP status to match.
 */

export const NO_STORE = { 'Cache-Control': 'no-store' }

const STATUS: Record<ErrorCode, number> = {
  UNAUTHENTICATED: 401,
  EMAIL_UNVERIFIED: 403,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  VALIDATION: 400,
  CONFLICT: 409,
}

/** Far above the largest real payload (every answer of the longest test). */
const MAX_BODY_CHARS = 1_000_000

export function invalid(field: string): never {
  throw new AppError('VALIDATION', 'Invalid input', { fields: [field] })
}

/**
 * Same-site only, as Next checks Server Actions: the browser's Origin must name this app's host
 * (the forwarded one behind a proxy). Browsers send Origin on every POST; none → refused.
 */
export function sameOrigin(request: Request): boolean {
  const origin = request.headers.get('origin')
  if (!origin) return false
  let originHost: string
  try {
    originHost = new URL(origin).host
  } catch {
    return false
  }
  const host =
    request.headers.get('x-forwarded-host')?.split(',')[0]?.trim() || request.headers.get('host') || new URL(request.url).host
  return originHost !== '' && originHost === host
}

/** The JSON body; blank → undefined; not JSON or too large → VALIDATION { fields: ['body'] }. */
export async function readJson(request: Request): Promise<unknown> {
  const text = await request.text()
  if (text.length > MAX_BODY_CHARS) invalid('body')
  if (text.trim() === '') return undefined
  try {
    return JSON.parse(text) as unknown
  } catch {
    invalid('body')
  }
}

export function respond<T>(result: ActionResult<T>): Response {
  return Response.json(result, { status: result.ok ? 200 : STATUS[result.code], headers: NO_STORE })
}

/** Origin check, then the body as an `ActionResult`; anything unexpected is a logged 500. */
export async function handleJson<T>(request: Request, tag: string, fn: () => Promise<T>): Promise<Response> {
  if (!sameOrigin(request)) return respond({ ok: false, code: 'FORBIDDEN' })
  try {
    return respond(await toActionResult(fn))
  } catch (err) {
    console.error(`[${tag}] unexpected error`, err instanceof Error ? err.name : 'UnknownError')
    return Response.json({ ok: false, code: 'INTERNAL' }, { status: 500, headers: NO_STORE })
  }
}
