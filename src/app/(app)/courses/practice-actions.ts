'use server'

import { revalidatePath } from 'next/cache'
import { toActionResult, type ActionResult } from '@/lib/action-result'
import { getCtx } from '@/server/auth/session'
import { AppError } from '@/server/core/errors'
import {
  addPracticeQuestion,
  deletePracticeGroup,
  deletePracticeQuestion,
  importTestQuestions,
  movePracticeQuestion,
  updatePracticeQuestion,
} from '@/server/revision/authoring'
import { recordPracticeOutcomes } from '@/server/revision/practice'
import { parsePracticeForm } from './practice-form'

function invalid(field: string): never {
  throw new AppError('VALIDATION', 'Invalid input', { fields: [field] })
}

function requireId(value: unknown, field: string): string {
  if (typeof value !== 'string' || value === '' || value.length > 100) invalid(field)
  return value
}

/** The lecturer's practice page of every topic, plus the notes pages that show its question count. */
function revalidatePractice() {
  revalidatePath('/courses/[courseId]/notes/topics/[topicId]/practice', 'page')
  revalidatePath('/courses/[courseId]/notes', 'page')
  revalidatePath('/courses/[courseId]/notes/[resourceId]', 'page')
}

export async function addPracticeQuestionAction(
  topicId: string,
  _prev: ActionResult<unknown> | null,
  data: FormData,
): Promise<ActionResult<{ id: string }>> {
  return toActionResult(async () => {
    const topic = requireId(topicId, 'topicId')
    const saved = await addPracticeQuestion(await getCtx(), topic, parsePracticeForm(data))
    revalidatePractice()
    return saved
  })
}

export async function updatePracticeQuestionAction(
  questionId: string,
  _prev: ActionResult<unknown> | null,
  data: FormData,
): Promise<ActionResult<null>> {
  return toActionResult(async () => {
    const id = requireId(questionId, 'questionId')
    await updatePracticeQuestion(await getCtx(), id, parsePracticeForm(data))
    revalidatePractice()
    return null
  })
}

export async function deletePracticeQuestionAction(questionId: string): Promise<ActionResult<null>> {
  return toActionResult(async () => {
    await deletePracticeQuestion(await getCtx(), requireId(questionId, 'questionId'))
    revalidatePractice()
    return null
  })
}

export async function movePracticeQuestionAction(questionId: string, dir: 'up' | 'down'): Promise<ActionResult<null>> {
  return toActionResult(async () => {
    const id = requireId(questionId, 'questionId')
    if (dir !== 'up' && dir !== 'down') invalid('dir')
    await movePracticeQuestion(await getCtx(), id, dir)
    revalidatePractice()
    return null
  })
}

export async function importTestAction(topicId: string, testId: string): Promise<ActionResult<{ count: number }>> {
  return toActionResult(async () => {
    const topic = requireId(topicId, 'topicId')
    const test = requireId(testId, 'testId')
    const { count } = await importTestQuestions(await getCtx(), topic, test)
    revalidatePractice()
    return { count }
  })
}

export async function deletePracticeGroupAction(groupId: string): Promise<ActionResult<null>> {
  return toActionResult(async () => {
    await deletePracticeGroup(await getCtx(), requireId(groupId, 'groupId'))
    revalidatePractice()
    return null
  })
}

/**
 * A student's queued answers. Questions they can't see now are skipped by the service without
 * failing the rest, so `ok` means the whole batch can leave the device's queue.
 */
export async function recordPracticeOutcomesAction(
  courseId: string,
  outcomes: { questionId: string; correct: boolean }[],
): Promise<ActionResult<{ saved: number }>> {
  return toActionResult(async () => {
    const course = requireId(courseId, 'courseId')
    return recordPracticeOutcomes(await getCtx(), course, outcomes)
  })
}
