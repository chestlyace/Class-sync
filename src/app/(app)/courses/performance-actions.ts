'use server'

import { revalidatePath } from 'next/cache'
import { toActionResult, type ActionResult } from '@/lib/action-result'
import { formString } from '@/lib/form-data'
import { getCtx } from '@/server/auth/session'
import { AppError } from '@/server/core/errors'
import { tapParticipation, undoLastTap, type UndoneTap } from '@/server/performance/participation'
import type { CaSettings } from '@/server/performance/rules'
import { updateCaSettings } from '@/server/performance/settings'
import { parseDecimalInput, parseWholeInput, POINT_FIELDS, type SettingsField } from './performance-form'

function invalid(fields: string[]): never {
  throw new AppError('VALIDATION', 'Invalid input', { fields })
}

function requireId(value: unknown, field: string): string {
  if (typeof value !== 'string' || value === '' || value.length > 100) invalid([field])
  return value
}

/**
 * Reads the settings form: every box must hold a number (all bad ones reported together). The
 * service then checks ranges, decimals and that the parts add up to the total. Test points come
 * with phase 3, so they are always 0 here.
 */
function parseSettingsForm(data: FormData): CaSettings {
  const bad: SettingsField[] = []
  const read = (field: SettingsField, parse: (raw: string) => number) => {
    const value = parse(formString(data, field))
    if (!Number.isFinite(value)) bad.push(field)
    return value
  }
  const total = read('total', parseDecimalInput)
  const [attendancePoints, assignmentPoints, participationPoints] = POINT_FIELDS.map((f) => read(f, parseDecimalInput))
  const participationTarget = read('participationTarget', parseWholeInput)
  if (bad.length > 0) invalid(bad)
  return { total, attendancePoints, assignmentPoints, participationPoints, testPoints: 0, participationTarget }
}

export async function updateCaSettingsAction(
  courseId: string,
  _prev: ActionResult<CaSettings> | null,
  data: FormData,
): Promise<ActionResult<CaSettings>> {
  return toActionResult(async () => {
    const id = requireId(courseId, 'courseId')
    const saved = await updateCaSettings(await getCtx(), id, parseSettingsForm(data))
    // The form lives on the CA page: refresh its table with the new split. (Both CA pages are
    // dynamic, so any other visit reads fresh data anyway.)
    revalidatePath('/courses/[courseId]/performance', 'page')
    return saved
  })
}

/**
 * One +1 or −1 for a student. Returns the student's new all-time net. No revalidation: the board
 * keeps its own counts, and the CA page is dynamic, so it reads fresh taps on the next visit.
 */
export async function tapParticipationAction(
  courseId: string,
  studentId: string,
  delta: number,
): Promise<ActionResult<{ net: number }>> {
  return toActionResult(async () => {
    const id = requireId(courseId, 'courseId')
    const student = requireId(studentId, 'studentId')
    if (delta !== 1 && delta !== -1) invalid(['delta'])
    return tapParticipation(await getCtx(), id, student, delta)
  })
}

/**
 * Removes my last tap in the course (last 10 minutes): whose, its delta, whether it was today,
 * and the new net. `null` when there is nothing to undo. No revalidation (see above).
 */
export async function undoLastTapAction(courseId: string): Promise<ActionResult<UndoneTap | null>> {
  return toActionResult(async () => undoLastTap(await getCtx(), requireId(courseId, 'courseId')))
}
