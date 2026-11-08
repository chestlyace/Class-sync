import { and, asc, eq, max, ne } from 'drizzle-orm'
import { sanitizeRichText } from '@/server/assignments/rich-text'
import type { Ctx } from '@/server/core/context'
import { AppError } from '@/server/core/errors'
import { requireRole } from '@/server/core/guards'
import { requireCourseOwner } from '@/server/courses/service'
import type { Db } from '@/server/db'
import { resource, resourcePlacement, type ResourceKind } from '@/server/db/schema'
import { isUniqueViolation } from '@/server/lib/db-errors'
import { claimResourceFile, deleteStoredFile } from '@/server/files/service'
import { richTextPlainText } from '@/lib/rich-text-content'
import { parseLinkUrl, parseTitle, swapPositions } from './rules'
import { assertTopicInCourse } from './topics'

type Executor = Pick<Db, 'select' | 'insert' | 'update' | 'delete'>

function invalid(...fields: string[]): never {
  throw new AppError('VALIDATION', `Invalid ${fields.join(', ')}`, { fields })
}

function forbidden(): never {
  throw new AppError('FORBIDDEN', 'You cannot change this item')
}

function titleOf(raw: unknown): string {
  return parseTitle(raw) ?? invalid('title')
}

/** The item's resource when the caller owns it; missing and not-yours are both FORBIDDEN. */
async function requireOwnedResource(db: Executor, ctx: Ctx, resourceId: string) {
  const [row] = await db
    .select({ id: resource.id, kind: resource.kind, ownerId: resource.ownerId, fileId: resource.fileId })
    .from(resource)
    .where(eq(resource.id, resourceId))
  if (!row || row.ownerId !== ctx.user.id) forbidden()
  return row
}

async function requirePlacement(db: Executor, resourceId: string, courseId: string) {
  const [row] = await db
    .select({ topicId: resourcePlacement.topicId })
    .from(resourcePlacement)
    .where(and(eq(resourcePlacement.resourceId, resourceId), eq(resourcePlacement.courseId, courseId)))
  if (!row) forbidden()
  return row
}

async function nextPosition(db: Executor, topicId: string): Promise<number> {
  const [last] = await db
    .select({ position: max(resourcePlacement.position) })
    .from(resourcePlacement)
    .where(eq(resourcePlacement.topicId, topicId))
  return (last?.position ?? 0) + 1
}

type NewItem = { courseId: string; topicId: string }

async function insertItem(
  ctx: Ctx,
  input: NewItem,
  values: (tx: Executor) => Promise<{
    kind: ResourceKind
    title: string
    body?: unknown
    bodyText?: string
    url?: string
    fileId?: string
  }>,
): Promise<{ id: string }> {
  await requireCourseOwner(ctx, input.courseId)
  return ctx.db.transaction(async (tx) => {
    await assertTopicInCourse(tx, input.topicId, input.courseId)
    const v = await values(tx)
    let row: { id: string }
    try {
      ;[row] = await tx
        .insert(resource)
        .values({
          ownerId: ctx.user.id,
          kind: v.kind,
          title: v.title,
          body: v.body ?? null,
          bodyText: v.bodyText ?? null,
          url: v.url ?? null,
          fileId: v.fileId ?? null,
        })
        .returning({ id: resource.id })
    } catch (err) {
      // Two items racing for one file: the loser of the unique index is a bad file, not a crash.
      if (isUniqueViolation(err, 'resource_file_id_unique')) invalid('file')
      throw err
    }
    await tx.insert(resourcePlacement).values({
      resourceId: row.id,
      courseId: input.courseId,
      topicId: input.topicId,
      position: await nextPosition(tx, input.topicId),
    })
    return { id: row.id }
  })
}

export async function createNote(
  ctx: Ctx,
  input: { courseId: string; topicId: string; title: string; body: unknown },
): Promise<{ id: string }> {
  return insertItem(ctx, input, async () => {
    const title = titleOf(input.title)
    const body = sanitizeRichText(input.body) ?? invalid('body')
    return { kind: 'note', title, body, bodyText: richTextPlainText(body) }
  })
}

export async function createLink(
  ctx: Ctx,
  input: { courseId: string; topicId: string; title: string; url: string },
): Promise<{ id: string }> {
  return insertItem(ctx, input, async () => {
    const title = titleOf(input.title)
    const url = parseLinkUrl(input.url) ?? invalid('url')
    return { kind: 'link', title, url }
  })
}

export async function createFileItem(
  ctx: Ctx,
  input: { courseId: string; topicId: string; title: string; fileId: string },
): Promise<{ id: string }> {
  return insertItem(ctx, input, async (tx) => {
    const title = titleOf(input.title)
    const claimed = await claimResourceFile(tx, input.fileId, ctx.user.id)
    return { kind: 'file', title, fileId: claimed.id }
  })
}

/** Editing the shared item changes it in every course it is placed in. */
export async function updateNote(ctx: Ctx, resourceId: string, input: { title: string; body: unknown }): Promise<void> {
  requireRole(ctx, 'lecturer')
  const row = await requireOwnedResource(ctx.db, ctx, resourceId)
  if (row.kind !== 'note') invalid('kind')
  const title = titleOf(input.title)
  const body = sanitizeRichText(input.body) ?? invalid('body')
  await ctx.db
    .update(resource)
    .set({ title, body, bodyText: richTextPlainText(body), updatedAt: new Date() })
    .where(eq(resource.id, resourceId))
}

export async function updateLink(ctx: Ctx, resourceId: string, input: { title: string; url: string }): Promise<void> {
  requireRole(ctx, 'lecturer')
  const row = await requireOwnedResource(ctx.db, ctx, resourceId)
  if (row.kind !== 'link') invalid('kind')
  const title = titleOf(input.title)
  const url = parseLinkUrl(input.url) ?? invalid('url')
  await ctx.db.update(resource).set({ title, url, updatedAt: new Date() }).where(eq(resource.id, resourceId))
}

/** A new file replaces the old one for every course; the old stored file is deleted. */
export async function updateFileItem(
  ctx: Ctx,
  resourceId: string,
  input: { title: string; fileId?: string },
): Promise<void> {
  requireRole(ctx, 'lecturer')
  const row = await requireOwnedResource(ctx.db, ctx, resourceId)
  if (row.kind !== 'file') invalid('kind')
  const title = titleOf(input.title)
  const replaced = await ctx.db.transaction(async (tx) => {
    // Lock the resource: the old file is whatever it holds now, and a removed item rolls the claim back.
    const [locked] = await tx
      .select({ fileId: resource.fileId })
      .from(resource)
      .where(eq(resource.id, resourceId))
      .for('update')
    if (!locked) forbidden()
    if (input.fileId === undefined || input.fileId === locked.fileId) {
      await tx.update(resource).set({ title, updatedAt: new Date() }).where(eq(resource.id, resourceId))
      return null
    }
    const next = await claimResourceFile(tx, input.fileId, ctx.user.id)
    try {
      await tx
        .update(resource)
        .set({ title, fileId: next.id, updatedAt: new Date() })
        .where(eq(resource.id, resourceId))
    } catch (err) {
      if (isUniqueViolation(err, 'resource_file_id_unique')) invalid('file')
      throw err
    }
    return locked.fileId
  })
  if (replaced) await deleteStoredFile(ctx.db, replaced)
}

/** To another topic of the same course (last place), or one place up or down within its topic. */
export async function moveItem(
  ctx: Ctx,
  input: { resourceId: string; courseId: string; topicId?: string; dir?: 'up' | 'down' },
): Promise<void> {
  await requireCourseOwner(ctx, input.courseId)
  await requireOwnedResource(ctx.db, ctx, input.resourceId)
  await ctx.db.transaction(async (tx) => {
    const placement = await requirePlacement(tx, input.resourceId, input.courseId)
    if (input.topicId !== undefined && input.topicId !== placement.topicId) {
      await assertTopicInCourse(tx, input.topicId, input.courseId)
      await tx
        .update(resourcePlacement)
        .set({ topicId: input.topicId, position: await nextPosition(tx, input.topicId) })
        .where(
          and(eq(resourcePlacement.resourceId, input.resourceId), eq(resourcePlacement.courseId, input.courseId)),
        )
      return
    }
    if (!input.dir) return
    const list = await tx
      .select({ id: resourcePlacement.resourceId })
      .from(resourcePlacement)
      .where(eq(resourcePlacement.topicId, placement.topicId))
      .orderBy(asc(resourcePlacement.position), asc(resourcePlacement.addedAt), asc(resourcePlacement.resourceId))
    const next = swapPositions(list, input.resourceId, input.dir)
    if (!next) return
    for (const [i, item] of next.entries()) {
      await tx
        .update(resourcePlacement)
        .set({ position: i + 1 })
        .where(and(eq(resourcePlacement.resourceId, item.id), eq(resourcePlacement.topicId, placement.topicId)))
    }
  })
}

/** Places the same item in another of the lecturer's courses (last place of the chosen topic). */
export async function shareItem(
  ctx: Ctx,
  input: { resourceId: string; targetCourseId: string; targetTopicId: string },
): Promise<void> {
  await requireCourseOwner(ctx, input.targetCourseId)
  await requireOwnedResource(ctx.db, ctx, input.resourceId)
  await ctx.db.transaction(async (tx) => {
    await assertTopicInCourse(tx, input.targetTopicId, input.targetCourseId)
    const inserted = await tx
      .insert(resourcePlacement)
      .values({
        resourceId: input.resourceId,
        courseId: input.targetCourseId,
        topicId: input.targetTopicId,
        position: await nextPosition(tx, input.targetTopicId),
      })
      .onConflictDoNothing()
      .returning({ id: resourcePlacement.resourceId })
    if (inserted.length === 0) {
      throw new AppError('CONFLICT', 'This item is already in that course', { reason: 'already_there' })
    }
  })
}

/**
 * Takes the item out of this course. Other courses keep it; the last placement deletes the resource
 * and its stored file.
 */
export async function removeItem(ctx: Ctx, input: { resourceId: string; courseId: string }): Promise<{ deleted: boolean }> {
  await requireCourseOwner(ctx, input.courseId)
  await requireOwnedResource(ctx.db, ctx, input.resourceId)
  const outcome = await ctx.db.transaction(async (tx) => {
    // Lock the resource so two removals cannot both see another placement left.
    const [locked] = await tx
      .select({ fileId: resource.fileId })
      .from(resource)
      .where(eq(resource.id, input.resourceId))
      .for('update')
    if (!locked) forbidden()
    await requirePlacement(tx, input.resourceId, input.courseId)
    await tx
      .delete(resourcePlacement)
      .where(and(eq(resourcePlacement.resourceId, input.resourceId), eq(resourcePlacement.courseId, input.courseId)))
    const [other] = await tx
      .select({ courseId: resourcePlacement.courseId })
      .from(resourcePlacement)
      .where(and(eq(resourcePlacement.resourceId, input.resourceId), ne(resourcePlacement.courseId, input.courseId)))
    if (other) return { deleted: false, fileId: null }
    await tx.delete(resource).where(eq(resource.id, input.resourceId))
    return { deleted: true, fileId: locked.fileId }
  })
  if (outcome.fileId) await deleteStoredFile(ctx.db, outcome.fileId)
  return { deleted: outcome.deleted }
}

