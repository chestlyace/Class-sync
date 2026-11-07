'use server'

import { redirect } from 'next/navigation'
import { toActionResult, type ActionResult } from '@/lib/action-result'
import { formString } from '@/lib/form-data'
import { getCtx } from '@/server/auth/session'
import { joinClassAsLecturer, joinClassAsStudent } from '@/server/classes/service'

/** Lecturers join with the lecturer code; students with the student code and their matricule. */
export async function joinClassAction(
  _prev: ActionResult<never> | null,
  data: FormData,
): Promise<ActionResult<never>> {
  return toActionResult(async () => {
    const ctx = await getCtx()
    const code = formString(data, 'code')
    const { classId } =
      ctx.user.role === 'lecturer'
        ? await joinClassAsLecturer(ctx, code)
        : await joinClassAsStudent(ctx, code, formString(data, 'matricule'))
    redirect(`/classes/${encodeURIComponent(classId)}`)
  })
}
