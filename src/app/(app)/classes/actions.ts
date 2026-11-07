'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { toActionResult, type ActionResult } from '@/lib/action-result'
import { formString } from '@/lib/form-data'
import { getCtx } from '@/server/auth/session'
import { createClass, regenerateJoinCode, removeStudentFromClass } from '@/server/classes/service'
import { AppError } from '@/server/core/errors'

type CodeKind = 'student' | 'lecturer'

function parseCodeKind(value: string): CodeKind {
  if (value === 'student' || value === 'lecturer') return value
  throw new AppError('VALIDATION', 'Invalid code kind', { fields: ['kind'] })
}

export async function createClassAction(
  _prev: ActionResult<never> | null,
  data: FormData,
): Promise<ActionResult<never>> {
  return toActionResult(async () => {
    const created = await createClass(await getCtx(), {
      schoolId: formString(data, 'schoolId'),
      name: formString(data, 'name'),
      academicYear: formString(data, 'academicYear').trim(),
    })
    redirect(`/classes/${encodeURIComponent(created.id)}`)
  })
}

export async function regenerateCodeAction(
  _prev: ActionResult<unknown> | null,
  data: FormData,
): Promise<ActionResult<{ code: string }>> {
  return toActionResult(async () => {
    const classId = formString(data, 'classId')
    const kind = parseCodeKind(formString(data, 'kind'))
    const code = await regenerateJoinCode(await getCtx(), classId, kind)
    revalidatePath(`/classes/${classId}`)
    return { code }
  })
}

export async function removeStudentAction(
  _prev: ActionResult<unknown> | null,
  data: FormData,
): Promise<ActionResult<null>> {
  return toActionResult(async () => {
    const classId = formString(data, 'classId')
    await removeStudentFromClass(await getCtx(), classId, formString(data, 'studentId'))
    revalidatePath(`/classes/${classId}`)
    return null
  })
}
