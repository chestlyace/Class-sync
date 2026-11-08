import { getCtx } from '@/server/auth/session'
import { suggestMarks } from '@/server/tests/marking'
import { handleJson, invalid, readJson } from '../../../route-kit'

/** Batches go to the provider in parallel, 30 s each. */
export const maxDuration = 60
export const dynamic = 'force-dynamic'

/** `{}` or no body → first ask; `{ "retry": true }` → Try again. */
async function readRetry(request: Request): Promise<boolean> {
  const body = await readJson(request)
  if (body === undefined) return false
  if (typeof body !== 'object' || body === null || Array.isArray(body)) invalid('body')
  const retry = (body as { retry?: unknown }).retry
  if (retry !== undefined && typeof retry !== 'boolean') invalid('retry')
  return retry === true
}

/**
 * Asks the AI for suggestions on the question's real answers that have none (when the lecturer
 * opens the question, or presses Try again). Stores suggestions only; never a mark. A Route
 * Handler, not a Server Action: a client runs its Server Actions one at a time, and a 30-60 s
 * provider call must never hold up the lecturer's Confirm or Save. The body is the action's
 * `ActionResult`, with an HTTP status to match.
 */
export async function POST(request: Request, { params }: RouteContext<'/api/tests/questions/[questionId]/suggestions'>) {
  return handleJson(request, 'suggestions', async () => {
    const ctx = await getCtx()
    const { questionId } = await params
    if (typeof questionId !== 'string' || questionId === '' || questionId.length > 100) invalid('questionId')
    return suggestMarks(ctx, questionId, { retry: await readRetry(request) })
  })
}
