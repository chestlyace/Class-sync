'use server'

import { revalidatePath } from 'next/cache'
import { toActionResult, type ActionResult } from '@/lib/action-result'
import { formString } from '@/lib/form-data'
import { getCtx } from '@/server/auth/session'
import { AppError } from '@/server/core/errors'
import { tapParticipation, undoLastTap } from '@/server/performance/participation'
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

/** The CA table reads the settings and the taps. */
function revalidateCa() {
  revalidatePath('/courses/[courseId]/performance', 'page')
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
    revalidateCa()
    // The board shows the participation target.
    revalidatePath('/courses/[courseId]/performance/participation', 'page')
    return saved
  })
}

/** One +1 or −1 for a student. Returns the student's new all-time net. */
export async function tapParticipationAction(
  courseId: string,
  studentId: string,
  delta: number,
): Promise<ActionResult<{ net: number }>> {
  return toActionResult(async () => {
    const id = requireId(courseId, 'courseId')
    const student = requireId(studentId, 'studentId')
    if (delta !== 1 && delta !== -1) invalid(['delta'])
    // The board keeps its own counts after loading, so only the CA table needs refreshing.
    const result = await tapParticipation(await getCtx(), id, student, delta)
    revalidateCa()
    return result
  })
}

/** Removes my last tap in the course (last 10 minutes). `null` when there is nothing to undo. */
export async function undoLastTapAction(
  courseId: string,
): Promise<ActionResult<{ studentId: string; net: number } | null>> {
  return toActionResult(async () => {
    const result = await undoLastTap(await getCtx(), requireId(courseId, 'courseId'))
    if (result) revalidateCa()
    return result
  })
}
