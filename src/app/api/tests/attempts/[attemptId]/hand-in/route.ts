import { getCtx } from '@/server/auth/session'
import { handIn, syncAttempt } from '@/server/tests/attempt'
import { parseSyncPayload } from '@/app/(test)/t/[code]/sync-payload'
import { toAttemptViewDto } from '@/app/(test)/t/[code]/view-dto'
import { handleJson, invalid, readJson } from '../../../route-kit'

export const dynamic = 'force-dynamic'

/**
 * Hands in with every local answer. Leave reports still queued are delivered first (with the
 * answers), so the log is complete and a leaving that already ended the attempt stands. Called
 * with `fetch` and a timeout, like the sync.
 */
export async function POST(request: Request, { params }: RouteContext<'/api/tests/attempts/[attemptId]/hand-in'>) {
  return handleJson(request, 'tests/hand-in', async () => {
    const { attemptId } = await params
    if (typeof attemptId !== 'string' || attemptId === '' || attemptId.length > 100) invalid('attemptId')
    const input = parseSyncPayload(await readJson(request))
    if (!input) invalid('payload')
    const ctx = await getCtx()
    let acceptedRevs: Record<string, number> = {}
    if (input.exits.length > 0) acceptedRevs = (await syncAttempt(ctx, attemptId, { ...input, withPaper: false })).acceptedRevs
    const view = await handIn(ctx, attemptId, { deviceId: input.deviceId, answers: input.answers })
    return toAttemptViewDto({ ...view, acceptedRevs })
  })
}
