'use server'

import { revalidatePath } from 'next/cache'
import { toActionResult, type ActionResult } from '@/lib/action-result'
import { parsePosition } from '@/lib/position'
import { getCtx } from '@/server/auth/session'
import { AppError } from '@/server/core/errors'
import { setSchoolLocation } from '@/server/schools/service'

/** Sets a school's campus to where the lecturer is standing. The service checks who may do it. */
export async function setSchoolLocationAction(schoolId: string, position: unknown): Promise<ActionResult<null>> {
  return toActionResult(async () => {
    const parsed = parsePosition(position)
    if (typeof schoolId !== 'string' || !parsed) {
      throw new AppError('VALIDATION', 'Invalid location', { fields: ['location'] })
    }
    await setSchoolLocation(await getCtx(), schoolId, { latitude: parsed.latitude, longitude: parsed.longitude })
    revalidatePath('/settings')
    return null
  })
}
