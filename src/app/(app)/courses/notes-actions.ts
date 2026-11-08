'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { toActionResult, type ActionResult } from '@/lib/action-result'
import { formString } from '@/lib/form-data'
import { getCtx } from '@/server/auth/session'
import { AppError } from '@/server/core/errors'
import {
  createFileItem,
  createLink,
  createNote,
  moveItem,
  removeItem,
  shareItem,
  updateFileItem,
  updateLink,
  updateNote,
} from '@/server/notes/items'
import { listCourseTopics } from '@/server/notes/read'
import { createTopic, deleteTopic, moveTopic, renameTopic, setTopicHidden } from '@/server/notes/topics'
import { isItemKind, parseItemForm, type ItemKind } from './notes-form'

function invalid(fields: string[]): never {
  throw new AppError('VALIDATION', 'Invalid input', { fields })
}

function requireId(value: unknown, field: string): string {
  if (typeof value !== 'string' || value === '' || value.length > 100) invalid([field])
  return value
}

function requireKind(value: unknown): ItemKind {
  if (!isItemKind(value)) invalid(['kind'])
  return value
}

function requireDir(value: unknown): 'up' | 'down' {
  if (value !== 'up' && value !== 'down') invalid(['dir'])
  return value
}

const notesPath = (courseId: string) => `/courses/${encodeURIComponent(courseId)}/notes`

/** Every page that shows topics or items; shared items and topics change other courses' pages too. */
function revalidateNotes() {
  revalidatePath('/courses/[courseId]/notes', 'page')
  revalidatePath('/courses/[courseId]/notes/[resourceId]', 'page')
  revalidatePath('/courses/[courseId]/notes/[resourceId]/edit', 'page')
}

export async function createTopicAction(
  courseId: string,
  _prev: ActionResult<null> | null,
  data: FormData,
): Promise<ActionResult<null>> {
  return toActionResult(async () => {
    await createTopic(await getCtx(), requireId(courseId, 'courseId'), { title: formString(data, 'title') })
    revalidateNotes()
    return null
  })
}

export async function renameTopicAction(
  topicId: string,
  _prev: ActionResult<null> | null,
  data: FormData,
): Promise<ActionResult<null>> {
  return toActionResult(async () => {
    await renameTopic(await getCtx(), requireId(topicId, 'topicId'), { title: formString(data, 'title') })
    revalidateNotes()
    return null
  })
}

export async function setTopicHiddenAction(topicId: string, hidden: boolean): Promise<ActionResult<null>> {
  return toActionResult(async () => {
    await setTopicHidden(await getCtx(), requireId(topicId, 'topicId'), hidden === true)
    revalidateNotes()
    return null
  })
}

export async function moveTopicAction(topicId: string, dir: 'up' | 'down'): Promise<ActionResult<null>> {
  return toActionResult(async () => {
    await moveTopic(await getCtx(), requireId(topicId, 'topicId'), requireDir(dir))
    revalidateNotes()
    return null
  })
}

/** Only an empty topic goes (CONFLICT `not_empty` otherwise). */
export async function deleteTopicAction(topicId: string): Promise<ActionResult<null>> {
  return toActionResult(async () => {
    await deleteTopic(await getCtx(), requireId(topicId, 'topicId'))
    revalidateNotes()
    return null
  })
}

/** Saves a new note, file or link at the end of the topic, then goes back to the notes page. */
export async function createItemAction(
  courseId: string,
  topicId: string,
  kind: ItemKind,
  _prev: ActionResult<never> | null,
  data: FormData,
): Promise<ActionResult<never>> {
  return toActionResult(async () => {
    const course = requireId(courseId, 'courseId')
    const topic = requireId(topicId, 'topic')
    const parsed = parseItemForm(requireKind(kind), data)
    if (!parsed.ok) invalid(parsed.fields)
    const ctx = await getCtx()
    const { value } = parsed
    if (value.kind === 'note') await createNote(ctx, { courseId: course, topicId: topic, title: value.title, body: value.body })
    else if (value.kind === 'link') await createLink(ctx, { courseId: course, topicId: topic, title: value.title, url: value.url })
    else await createFileItem(ctx, { courseId: course, topicId: topic, title: value.title, fileId: value.fileId })
    revalidateNotes()
    redirect(notesPath(course))
  })
}

/** Edits the shared item (every course that has it changes), then goes back to the notes page. */
export async function updateItemAction(
  courseId: string,
  resourceId: string,
  kind: ItemKind,
  _prev: ActionResult<never> | null,
  data: FormData,
): Promise<ActionResult<never>> {
  return toActionResult(async () => {
    const course = requireId(courseId, 'courseId')
    const id = requireId(resourceId, 'resourceId')
    const parsed = parseItemForm(requireKind(kind), data)
    if (!parsed.ok) invalid(parsed.fields)
    const ctx = await getCtx()
    const { value } = parsed
    if (value.kind === 'note') await updateNote(ctx, id, { title: value.title, body: value.body })
    else if (value.kind === 'link') await updateLink(ctx, id, { title: value.title, url: value.url })
    else await updateFileItem(ctx, id, { title: value.title, fileId: value.fileId })
    revalidateNotes()
    redirect(notesPath(course))
  })
}

/** To another topic of this course (last place), or one place up or down. */
export async function moveItemAction(
  courseId: string,
  resourceId: string,
  target: { topicId?: string; dir?: 'up' | 'down' },
): Promise<ActionResult<null>> {
  return toActionResult(async () => {
    const topicId = target.topicId === undefined ? undefined : requireId(target.topicId, 'topic')
    const dir = target.dir === undefined ? undefined : requireDir(target.dir)
    if (topicId === undefined && dir === undefined) invalid(['topic'])
    await moveItem(await getCtx(), {
      courseId: requireId(courseId, 'courseId'),
      resourceId: requireId(resourceId, 'resourceId'),
      topicId,
      dir,
    })
    revalidateNotes()
    return null
  })
}

/** Places the same item in another of my courses (CONFLICT `already_there` when it is already in it). */
export async function shareItemAction(
  resourceId: string,
  targetCourseId: string,
  targetTopicId: string,
): Promise<ActionResult<null>> {
  return toActionResult(async () => {
    await shareItem(await getCtx(), {
      resourceId: requireId(resourceId, 'resourceId'),
      targetCourseId: requireId(targetCourseId, 'course'),
      targetTopicId: requireId(targetTopicId, 'topic'),
    })
    revalidateNotes()
    return null
  })
}

/** The topics of one of my courses, for the share dialog's topic picker. */
export async function listTopicsAction(courseId: string): Promise<ActionResult<{ id: string; title: string }[]>> {
  return toActionResult(async () => listCourseTopics(await getCtx(), requireId(courseId, 'course')))
}

/** Takes the item out of this course only; the last course to drop it deletes it. */
export async function removeItemAction(courseId: string, resourceId: string): Promise<ActionResult<{ deleted: boolean }>> {
  return toActionResult(async () => {
    const result = await removeItem(await getCtx(), {
      courseId: requireId(courseId, 'courseId'),
      resourceId: requireId(resourceId, 'resourceId'),
    })
    revalidateNotes()
    return result
  })
}
