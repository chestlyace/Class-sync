'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { toActionResult, type ActionResult } from '@/lib/action-result'
import { formString } from '@/lib/form-data'
import { getCtx } from '@/server/auth/session'
import { AppError } from '@/server/core/errors'
import { createCourse, setRosterAdjustment } from '@/server/courses/service'

function invalid(field: string): never {
  throw new AppError('VALIDATION', 'Invalid input', { fields: [field] })
}

function parseSemester(value: string): 1 | 2 | 3 {
  if (value === '1' || value === '2' || value === '3') return Number(value) as 1 | 2 | 3
  invalid('semester')
}

/** 'clear' removes the adjustment (the service's `null`). */
function parseAdjustment(value: string): 'include' | 'exclude' | null {
  if (value === 'include' || value === 'exclude') return value
  if (value === 'clear') return null
  invalid('kind')
}

export async function createCourseAction(
  _prev: ActionResult<never> | null,
  data: FormData,
): Promise<ActionResult<never>> {
  return toActionResult(async () => {
    const ctx = await getCtx()
    const semester = parseSemester(formString(data, 'semester'))
    const course = await createCourse(ctx, {
      classId: formString(data, 'classId'),
      title: formString(data, 'title'),
      code: formString(data, 'code'),
      semester,
    })
    redirect(`/courses/${encodeURIComponent(course.id)}`)
  })
}

export async function setRosterAdjustmentAction(
  _prev: ActionResult<unknown> | null,
  data: FormData,
): Promise<ActionResult<null>> {
  return toActionResult(async () => {
    const courseId = formString(data, 'courseId')
    const kind = parseAdjustment(formString(data, 'kind'))
    await setRosterAdjustment(await getCtx(), courseId, formString(data, 'studentId'), kind)
    revalidatePath(`/courses/${courseId}`)
    return null
  })
}
