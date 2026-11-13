'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { toActionResult, type ActionResult } from '@/lib/action-result'
import { getCtx } from '@/server/auth/session'
import { AppError } from '@/server/core/errors'
import { addMakeUp, answerSitting, cancelClass, undoCancel, type MakeUpInput } from '@/server/schedule/changes'
import { createSlot, removeSlot, updateSlot, type SlotOverlap } from '@/server/schedule/timetable'
import { startClassAttendance } from '@/server/schedule/views'
import { parseCheckbox, parseMakeUpForm, parseSlotForm } from './schedule-form'

export type SlotSaved = { overlaps: SlotOverlap[] }

function invalid(field: string): never {
  throw new AppError('VALIDATION', 'Invalid input', { fields: [field] })
}

function requireId(value: unknown, field: string): string {
  if (typeof value !== 'string' || value === '') invalid(field)
  return value
}

/** Every screen that shows classes: the week, the class pages, the timetables and the dashboards. */
function revalidateSchedule() {
  revalidatePath('/schedule')
  revalidatePath('/schedule/class/[key]', 'page')
  revalidatePath('/courses/[courseId]/timetable', 'page')
  revalidatePath('/dashboard')
}

export async function createSlotAction(courseId: string, data: FormData): Promise<ActionResult<SlotSaved>> {
  return toActionResult(async () => {
    const id = requireId(courseId, 'courseId')
    const { overlaps } = await createSlot(await getCtx(), id, parseSlotForm(data))
    revalidateSchedule()
    return { overlaps }
  })
}

export async function updateSlotAction(slotId: string, data: FormData): Promise<ActionResult<SlotSaved>> {
  return toActionResult(async () => {
    const id = requireId(slotId, 'slotId')
    const { overlaps } = await updateSlot(await getCtx(), id, parseSlotForm(data))
    revalidateSchedule()
    return { overlaps }
  })
}

export async function removeSlotAction(slotId: string): Promise<ActionResult<null>> {
  return toActionResult(async () => {
    await removeSlot(await getCtx(), requireId(slotId, 'slotId'))
    revalidateSchedule()
    return null
  })
}

/** "Can't make it": with the make-up box ticked, the form's make-up fields are saved with the cancellation. */
export async function cancelClassAction(key: string, data: FormData): Promise<ActionResult<null>> {
  return toActionResult(async () => {
    const occurrenceKey = requireId(key, 'key')
    let makeUp: MakeUpInput | undefined
    if (parseCheckbox(data, 'makeUp')) {
      const { date, startMinute, endMinute, room, requireOnCampus } = parseMakeUpForm(data)
      makeUp = { date, startMinute, endMinute, room, requireOnCampus }
    }
    await cancelClass(await getCtx(), occurrenceKey, makeUp)
    revalidateSchedule()
    return null
  })
}

export async function undoCancelAction(key: string): Promise<ActionResult<null>> {
  return toActionResult(async () => {
    await undoCancel(await getCtx(), requireId(key, 'key'))
    revalidateSchedule()
    return null
  })
}

export async function addMakeUpAction(courseId: string, data: FormData): Promise<ActionResult<null>> {
  return toActionResult(async () => {
    const id = requireId(courseId, 'courseId')
    await addMakeUp(await getCtx(), id, parseMakeUpForm(data))
    revalidateSchedule()
    return null
  })
}

export async function answerSittingAction(key: string, answer: string): Promise<ActionResult<null>> {
  return toActionResult(async () => {
    const sittingKey = requireId(key, 'key')
    if (answer !== 'missed' && answer !== 'taught') invalid('answer')
    await answerSitting(await getCtx(), sittingKey, answer)
    revalidateSchedule()
    return null
  })
}

/** One tap: opens (or finds) the sitting's attendance session, then shows its live code. */
export async function startClassAttendanceAction(key: string): Promise<ActionResult<never>> {
  return toActionResult(async () => {
    const { courseId, sessionId } = await startClassAttendance(await getCtx(), requireId(key, 'key'))
    revalidateSchedule()
    revalidatePath('/courses/[courseId]/attendance', 'page')
    redirect(`/courses/${encodeURIComponent(courseId)}/attendance/${encodeURIComponent(sessionId)}`)
  })
}
