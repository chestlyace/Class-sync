'use server'

import { redirect } from 'next/navigation'
import { toActionResult, type ActionResult } from '@/lib/action-result'
import { formString, optionalCoordinate } from '@/lib/form-data'
import { getCtx } from '@/server/auth/session'
import { AppError } from '@/server/core/errors'
import { createSchool, searchSchools, type School } from '@/server/schools/service'

const MAX_QUERY_LENGTH = 120

export async function searchSchoolsAction(query: string): Promise<ActionResult<School[]>> {
  return toActionResult(async () => {
    if (typeof query !== 'string') throw new AppError('VALIDATION', 'Invalid query', { fields: ['query'] })
    return searchSchools(await getCtx(), query.slice(0, MAX_QUERY_LENGTH))
  })
}

/** Creates the school, then continues to "new class" at it. CONFLICT carries existingSchoolId. */
export async function createSchoolAction(
  _prev: ActionResult<never> | null,
  data: FormData,
): Promise<ActionResult<never>> {
  return toActionResult(async () => {
    const ctx = await getCtx()
    const school = await createSchool(ctx, {
      name: formString(data, 'name'),
      town: formString(data, 'town'),
      // Both or neither: the service rejects a half-set location.
      latitude: optionalCoordinate(data, 'latitude'),
      longitude: optionalCoordinate(data, 'longitude'),
    })
    redirect(`/classes/new?schoolId=${encodeURIComponent(school.id)}`)
  })
}
