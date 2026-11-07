'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { toActionResult, type ActionResult } from '@/lib/action-result'
import { formString } from '@/lib/form-data'
import { getCtx } from '@/server/auth/session'
import { AppError } from '@/server/core/errors'
import {
  closeWindow,
  createSession,
  deleteSession,
  getLiveWindow,
  getSession,
  openWindow,
  setAttendanceOverride,
  type LiveWindow,
  type WindowKind,
} from '@/server/attendance/sessions'
import type { OverrideStatus } from '@/server/attendance/status'

/** A `LiveWindow` that can cross to the client: dates as ISO strings. */
export type LiveWindowView = Omit<LiveWindow, 'closesAt'> & { closesAt: string }

function invalid(field: string): never {
  throw new AppError('VALIDATION', 'Invalid input', { fields: [field] })
}

function requireId(value: unknown, field: string): string {
  if (typeof value !== 'string' || value === '') invalid(field)
  return value
}

function parseKind(value: unknown): WindowKind {
  if (value === 'start' || value === 'end') return value
  invalid('kind')
}

/** 'auto' clears the override (the service's `null`). */
function parseOverride(value: unknown): OverrideStatus | null {
  if (value === 'present' || value === 'partial' || value === 'absent') return value
  if (value === 'auto') return null
  invalid('status')
}

/** An unchecked box is absent from the form; a checked one sends "on". */
function parseCheckbox(data: FormData, key: string): boolean {
  const value = formString(data, key)
  if (value === '') return false
  if (value === 'on') return true
  invalid(key)
}

function toView(live: LiveWindow): LiveWindowView {
  return { ...live, closesAt: live.closesAt.toISOString() }
}

/** The grid and every session page read the same rows. */
function revalidateAttendance() {
  revalidatePath('/courses/[courseId]/attendance', 'page')
  revalidatePath('/courses/[courseId]/attendance/[sessionId]', 'page')
}

export async function createSessionAction(courseId: string, data: FormData): Promise<ActionResult<never>> {
  return toActionResult(async () => {
    const id = requireId(courseId, 'courseId')
    const requireOnCampus = parseCheckbox(data, 'requireOnCampus')
    const session = await createSession(await getCtx(), id, { requireOnCampus })
    revalidateAttendance()
    redirect(`/courses/${encodeURIComponent(id)}/attendance/${encodeURIComponent(session.id)}`)
  })
}

export async function openWindowAction(sessionId: string, kind: string): Promise<ActionResult<LiveWindowView>> {
  return toActionResult(async () => {
    const id = requireId(sessionId, 'sessionId')
    const live = await openWindow(await getCtx(), id, parseKind(kind))
    revalidateAttendance()
    return toView(live)
  })
}

export async function closeWindowAction(windowId: string): Promise<ActionResult<null>> {
  return toActionResult(async () => {
    await closeWindow(await getCtx(), requireId(windowId, 'windowId'))
    revalidateAttendance()
    return null
  })
}

/** Polled by the lecturer's live panel. */
export async function getLiveWindowAction(windowId: string): Promise<ActionResult<LiveWindowView>> {
  return toActionResult(async () => toView(await getLiveWindow(await getCtx(), requireId(windowId, 'windowId'))))
}

export async function setOverrideAction(
  sessionId: string,
  studentId: string,
  status: string,
): Promise<ActionResult<null>> {
  return toActionResult(async () => {
    const id = requireId(sessionId, 'sessionId')
    const student = requireId(studentId, 'studentId')
    await setAttendanceOverride(await getCtx(), id, student, parseOverride(status))
    revalidateAttendance()
    return null
  })
}

/** Deletes the session, then goes back to the course's attendance grid. */
export async function deleteSessionAction(sessionId: string): Promise<ActionResult<never>> {
  return toActionResult(async () => {
    const id = requireId(sessionId, 'sessionId')
    const ctx = await getCtx()
    const { session } = await getSession(ctx, id) // FORBIDDEN unless mine; tells us the course
    await deleteSession(ctx, id)
    revalidateAttendance()
    redirect(`/courses/${encodeURIComponent(session.courseId)}/attendance`)
  })
}
