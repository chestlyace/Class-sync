import { getCtx } from '@/server/auth/session'
import { syncAttempt } from '@/server/tests/attempt'
import { parseSyncPayload } from '@/app/(test)/t/[code]/sync-payload'
import { toAttemptViewDto } from '@/app/(test)/t/[code]/view-dto'
import { handleJson, invalid, readJson } from '../../../route-kit'

export const dynamic = 'force-dynamic'

/**
 * The runner's heartbeat: queued answers and leave reports up; the attempt's state and server
 * time down (the paper and saved answers only with `withPaper`). Called with `fetch` and a
 * timeout: a request stuck on a weak connection is aborted and retried, never waited on.
 */
export async function POST(request: Request, { params }: RouteContext<'/api/tests/attempts/[attemptId]/sync'>) {
  return handleJson(request, 'tests/sync', async () => {
    const { attemptId } = await params
    if (typeof attemptId !== 'string' || attemptId === '' || attemptId.length > 100) invalid('attemptId')
    const input = parseSyncPayload(await readJson(request))
    if (!input) invalid('payload')
    return toAttemptViewDto(await syncAttempt(await getCtx(), attemptId, input))
  })
}
