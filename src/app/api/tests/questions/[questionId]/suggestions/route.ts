import { toActionResult, type ActionResult } from '@/lib/action-result'
import { getCtx } from '@/server/auth/session'
import { AppError, type ErrorCode } from '@/server/core/errors'
import { suggestMarks } from '@/server/tests/marking'

/** Batches go to the provider in parallel, 30 s each. */
export const maxDuration = 60
export const dynamic = 'force-dynamic'

const HEADERS = { 'Cache-Control': 'no-store' }

const STATUS: Record<ErrorCode, number> = {
  UNAUTHENTICATED: 401,
  EMAIL_UNVERIFIED: 403,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  VALIDATION: 400,
  CONFLICT: 409,
}

function invalid(field: string): never {
  throw new AppError('VALIDATION', 'Invalid input', { fields: [field] })
}

/**
 * Same-site only, as Next checks Server Actions: the browser's Origin must name this app's host
 * (the forwarded one behind a proxy). Browsers send Origin on every POST; none → refused.
 */
function sameOrigin(request: Request): boolean {
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

/** `{}` or no body → first ask; `{ "retry": true }` → Try again. */
async function readRetry(request: Request): Promise<boolean> {
  const text = await request.text()
  if (text.trim() === '') return false
  let body: unknown
  try {
    body = JSON.parse(text)
  } catch {
    invalid('body')
  }
  if (typeof body !== 'object' || body === null || Array.isArray(body)) invalid('body')
  const retry = (body as { retry?: unknown }).retry
  if (retry !== undefined && typeof retry !== 'boolean') invalid('retry')
  return retry === true
}

function respond<T>(result: ActionResult<T>): Response {
  return Response.json(result, { status: result.ok ? 200 : STATUS[result.code], headers: HEADERS })
}

/**
 * Asks the AI for suggestions on the question's real answers that have none (when the lecturer
 * opens the question, or presses Try again). Stores suggestions only; never a mark. A Route
 * Handler, not a Server Action: a client runs its Server Actions one at a time, and a 30-60 s
 * provider call must never hold up the lecturer's Confirm or Save. The body is the action's
 * `ActionResult`, with an HTTP status to match.
 */
export async function POST(request: Request, { params }: RouteContext<'/api/tests/questions/[questionId]/suggestions'>) {
  if (!sameOrigin(request)) return respond({ ok: false, code: 'FORBIDDEN' })
  try {
    const result = await toActionResult(async () => {
      const ctx = await getCtx()
      const { questionId } = await params
      if (typeof questionId !== 'string' || questionId === '' || questionId.length > 100) invalid('questionId')
      return suggestMarks(ctx, questionId, { retry: await readRetry(request) })
    })
    return respond(result)
  } catch (err) {
    console.error('[suggestions] unexpected error', err instanceof Error ? err.name : 'UnknownError')
    return Response.json({ ok: false, code: 'INTERNAL' }, { status: 500, headers: HEADERS })
  }
}
