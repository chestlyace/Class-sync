import { getCtx } from '@/server/auth/session'
import { openTest } from '@/server/tests/attempt'
import { toAttemptViewDto } from '@/app/(test)/t/[code]/view-dto'
import { handleJson, invalid, readJson } from '../route-kit'

export const dynamic = 'force-dynamic'

const MAX_CODE_LENGTH = 50
const MAX_ID_LENGTH = 100

/**
 * Opens the test behind a link on this device (creates the attempt at the first open). Body:
 * `{ code, deviceId }`. The student's runner calls it with a timeout, so a stalled request never
 * leaves "Opening the test…" up for good.
 */
export async function POST(request: Request) {
  return handleJson(request, 'tests/open', async () => {
    const body = await readJson(request)
    if (typeof body !== 'object' || body === null || Array.isArray(body)) invalid('body')
    const { code, deviceId } = body as { code?: unknown; deviceId?: unknown }
    if (typeof code !== 'string' || code.length === 0 || code.length > MAX_CODE_LENGTH) invalid('code')
    if (typeof deviceId !== 'string' || deviceId.length === 0 || deviceId.length > MAX_ID_LENGTH) invalid('deviceId')
    return toAttemptViewDto(await openTest(await getCtx(), code, deviceId))
  })
}
