'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { toActionResult, type ActionResult } from '@/lib/action-result'
import { formString } from '@/lib/form-data'
import { getCtx } from '@/server/auth/session'
import { createClass, regenerateJoinCode, removeStudentFromClass, updateClass } from '@/server/classes/service'
import { removeClass } from '@/server/classes/remove'
import { updateSchool } from '@/server/schools/service'
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

export async function updateClassAction(
  _prev: ActionResult<never> | null,
  data: FormData,
): Promise<ActionResult<never>> {
  return toActionResult(async () => {
    const classId = formString(data, 'classId')
    await updateClass(await getCtx(), classId, {
      name: formString(data, 'name'),
      academicYear: formString(data, 'academicYear').trim(),
    })
    // The class name shows on dashboards, course pages and the schedule of everyone in it.
    revalidatePath('/', 'layout')
    redirect(`/classes/${encodeURIComponent(classId)}`)
  })
}

/** CONFLICT when another school already has the name and town. */
export async function updateSchoolAction(
  _prev: ActionResult<never> | null,
  data: FormData,
): Promise<ActionResult<never>> {
  return toActionResult(async () => {
    const classId = formString(data, 'classId')
    await updateSchool(await getCtx(), formString(data, 'schoolId'), {
      name: formString(data, 'name'),
      town: formString(data, 'town'),
    })
    revalidatePath('/', 'layout')
    redirect(`/classes/${encodeURIComponent(classId)}`)
  })
}

/** Deletes the class, or leaves it when colleagues teach it too (the service decides). */
export async function removeClassAction(
  _prev: ActionResult<never> | null,
  data: FormData,
): Promise<ActionResult<never>> {
  return toActionResult(async () => {
    await removeClass(await getCtx(), formString(data, 'classId'), formString(data, 'confirm'))
    revalidatePath('/', 'layout')
    redirect('/dashboard')
  })
}
