'use server'

import { revalidatePath } from 'next/cache'
import { toActionResult, type ActionResult } from '@/lib/action-result'
import { getCtx } from '@/server/auth/session'
import { markGuideSeen } from '@/server/guides/service'

/** A guide was finished or closed: it won't start by itself again for this account. */
export async function markGuideSeenAction(guideId: string): Promise<ActionResult<null>> {
  return toActionResult(async () => {
    await markGuideSeen(await getCtx(), guideId)
    // The Settings list ticks seen guides.
    revalidatePath('/settings')
    return null
  })
}
