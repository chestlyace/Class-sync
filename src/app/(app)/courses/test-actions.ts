'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { toActionResult, type ActionResult } from '@/lib/action-result'
import { getCtx } from '@/server/auth/session'
import { AppError } from '@/server/core/errors'
import { copyTest, createTest, deleteTest, updateTest } from '@/server/tests/authoring'
import { requireOwnedTest } from '@/server/tests/queries'
import {
  endTestForEveryone,
  getAttemptLog,
  getLiveTest,
  letBackIn,
  startTest,
  type LiveTest,
  type LogEntry,
} from '@/server/tests/run'
import { parseTestForm } from './test-form'

/** `LiveTest` with its dates as ISO strings, as the live page polls it. */
export type LiveTestView = Omit<LiveTest, 'endsAt' | 'serverNow'> & { endsAt: string | null; serverNow: string }
export type LogEntryView = Omit<LogEntry, 'at'> & { at: string }

function invalid(field: string): never {
  throw new AppError('VALIDATION', 'Invalid input', { fields: [field] })
}

function requireId(value: unknown, field: string): string {
  if (typeof value !== 'string' || value === '' || value.length > 100) invalid(field)
  return value
}

const coursePath = (courseId: string) => `/courses/${encodeURIComponent(courseId)}`
const testsPath = (courseId: string) => `${coursePath(courseId)}/tests`

/** Every lecturer page that shows a test. */
function revalidateTests() {
  revalidatePath('/courses/[courseId]/tests', 'page')
  revalidatePath('/courses/[courseId]/tests/[testId]', 'page')
  revalidatePath('/courses/[courseId]/tests/[testId]/edit', 'page')
  revalidatePath('/courses/[courseId]/tests/[testId]/results', 'page')
}

function toLiveView(live: LiveTest): LiveTestView {
  return { ...live, endsAt: live.endsAt?.toISOString() ?? null, serverNow: live.serverNow.toISOString() }
}

/**
 * "Save and get the link": creates the test (no `testId`) or replaces it. `payload` is the
 * editor's values (text fields); the service validates them. The editor clears its draft and
 * opens the live page on success, so this returns the id instead of redirecting.
 */
export async function saveTestAction(
  courseId: string,
  testId: string | null,
  payload: unknown,
): Promise<ActionResult<{ testId: string }>> {
  return toActionResult(async () => {
    const course = requireId(courseId, 'courseId')
    const id = testId === null ? null : requireId(testId, 'testId')
    const input = parseTestForm(payload)
    const ctx = await getCtx()
    const saved = id === null ? await createTest(ctx, course, input) : await updateTest(ctx, id, input)
    revalidateTests()
    return { testId: saved.id }
  })
}

/** Copies the test into one of my courses, then opens the copy's edit page. */
export async function copyTestAction(testId: string, targetCourseId: string): Promise<ActionResult<never>> {
  return toActionResult(async () => {
    const id = requireId(testId, 'testId')
    const target = requireId(targetCourseId, 'courseId')
    const copy = await copyTest(await getCtx(), id, target)
    revalidateTests()
    redirect(`${testsPath(copy.courseId)}/${encodeURIComponent(copy.id)}/edit?copied=1`)
  })
}

/** Deletes a test that has not started, then goes back to the course's tests. */
export async function deleteTestAction(testId: string): Promise<ActionResult<never>> {
  return toActionResult(async () => {
    const id = requireId(testId, 'testId')
    const ctx = await getCtx()
    const { test } = await requireOwnedTest(ctx, id)
    await deleteTest(ctx, id)
    revalidateTests()
    redirect(testsPath(test.courseId))
  })
}

export async function startTestAction(testId: string): Promise<ActionResult<null>> {
  return toActionResult(async () => {
    await startTest(await getCtx(), requireId(testId, 'testId'))
    revalidateTests()
    return null
  })
}

export async function endTestAction(testId: string): Promise<ActionResult<null>> {
  return toActionResult(async () => {
    await endTestForEveryone(await getCtx(), requireId(testId, 'testId'))
    revalidateTests()
    return null
  })
}

export async function letBackInAction(attemptId: string): Promise<ActionResult<null>> {
  return toActionResult(async () => {
    await letBackIn(await getCtx(), requireId(attemptId, 'attemptId'))
    return null
  })
}

/** The live view, polled every TEST_LIVE_POLL_MS. */
export async function getLiveTestAction(testId: string): Promise<ActionResult<LiveTestView>> {
  return toActionResult(async () => toLiveView(await getLiveTest(await getCtx(), requireId(testId, 'testId'))))
}

export async function getAttemptLogAction(attemptId: string): Promise<ActionResult<LogEntryView[]>> {
  return toActionResult(async () => {
    const log = await getAttemptLog(await getCtx(), requireId(attemptId, 'attemptId'))
    return log.map((entry) => ({ ...entry, at: entry.at.toISOString() }))
  })
}
