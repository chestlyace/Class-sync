import { and, asc, count, eq, inArray, ne, or, ilike, type SQL } from 'drizzle-orm'
import { sanitizeRichText, type Block } from '@/server/assignments/rich-text'
import { now } from '@/server/core/clock'
import type { Ctx } from '@/server/core/context'
import { AppError } from '@/server/core/errors'
import { getCourse, listLecturerCourses, requireCourseOwner, type CourseSummary } from '@/server/courses/service'
import type { Db } from '@/server/db'
import {
  class_,
  course,
  courseTopic,
  file,
  resource,
  resourcePlacement,
  resourceView,
  revisionGroup,
  revisionQuestion,
  school,
  type ResourceKind,
} from '@/server/db/schema'
import type { FileInfo } from '@/server/files/service'
import { containsPattern } from '@/server/lib/like'
import { familyHolds } from '@/server/revision/hold'
import { hostOf, SEARCH_MAX } from './rules'

export type NoteItem = {
  id: string
  kind: ResourceKind
  title: string
  host: string | null
  file: FileInfo | null
  updatedAt: Date
  isNew: boolean
  sharedInCount: number
}
export type PracticeEntry = { count: number; held: boolean } | null
export type NotesTopic = { id: string; title: string; hidden: boolean; items: NoteItem[]; practice: PracticeEntry }

const label = (c: { title: string; schoolName: string; className: string }) =>
  `${c.title} · ${c.schoolName} · ${c.className}`

function forbidden(): never {
  throw new AppError('FORBIDDEN', 'You do not have access to this item')
}

/** Question counts per topic of a course, for the viewer: students never count held groups. */
async function practiceByTopic(db: Db, courseId: string, role: 'lecturer' | 'student'): Promise<Map<string, PracticeEntry>> {
  const groups = await db
    .select({
      topicId: revisionGroup.topicId,
      familyId: revisionGroup.sourceFamilyId,
      n: count(revisionQuestion.id),
    })
    .from(revisionGroup)
    .leftJoin(revisionQuestion, eq(revisionQuestion.groupId, revisionGroup.id))
    .where(eq(revisionGroup.courseId, courseId))
    .groupBy(revisionGroup.id, revisionGroup.topicId, revisionGroup.sourceFamilyId)
  const families = [...new Set(groups.flatMap((g) => (g.familyId ? [g.familyId] : [])))]
  const holds = await familyHolds(db, families, now())
  const out = new Map<string, PracticeEntry>()
  for (const g of groups) {
    const held = g.familyId !== null && holds.has(g.familyId)
    if (g.n === 0 || (role === 'student' && held)) continue
    const prev = out.get(g.topicId)
    out.set(g.topicId, { count: (prev?.count ?? 0) + g.n, held: (prev?.held ?? false) || (role === 'lecturer' && held) })
  }
  return out
}

/** Labels of the lecturer's other courses where the item is also placed. */
async function alsoInLabels(db: Db, resourceId: string, courseId: string): Promise<string[]> {
  const rows = await db
    .select({ title: course.title, schoolName: school.name, className: class_.name })
    .from(resourcePlacement)
    .innerJoin(course, eq(course.id, resourcePlacement.courseId))
    .innerJoin(class_, eq(class_.id, course.classId))
    .innerJoin(school, eq(school.id, class_.schoolId))
    .where(and(eq(resourcePlacement.resourceId, resourceId), ne(resourcePlacement.courseId, courseId)))
    .orderBy(asc(course.title), asc(course.id))
  return rows.map(label)
}

export async function getCourseNotes(
  ctx: Ctx,
  courseId: string,
  opts: { q?: string } = {},
): Promise<{
  role: 'lecturer' | 'student'
  course: CourseSummary
  topics: NotesTopic[]
  otherCourses: { id: string; label: string }[]
}> {
  const summary = await getCourse(ctx, courseId)
  const role = ctx.user.role === 'lecturer' ? 'lecturer' : 'student'
  const q = (opts.q ?? '').trim()
  if (q.length > SEARCH_MAX) throw new AppError('VALIDATION', 'The search is too long', { fields: ['q'] })

  const topicRows = await ctx.db
    .select({ id: courseTopic.id, title: courseTopic.title, hidden: courseTopic.hidden })
    .from(courseTopic)
    .where(role === 'student' ? and(eq(courseTopic.courseId, courseId), eq(courseTopic.hidden, false)) : eq(courseTopic.courseId, courseId))
    .orderBy(asc(courseTopic.position), asc(courseTopic.createdAt), asc(courseTopic.id))

  const conditions: SQL[] = [eq(resourcePlacement.courseId, courseId)]
  if (q) {
    const pattern = containsPattern(q)
    conditions.push(or(ilike(resource.title, pattern), ilike(resource.bodyText, pattern))!)
  }
  const itemRows = await ctx.db
    .select({
      id: resource.id,
      kind: resource.kind,
      title: resource.title,
      url: resource.url,
      updatedAt: resource.updatedAt,
      topicId: resourcePlacement.topicId,
      fileId: file.id,
      fileName: file.name,
      mimeType: file.mimeType,
      sizeBytes: file.sizeBytes,
      viewed: resourceView.resourceId,
    })
    .from(resourcePlacement)
    .innerJoin(resource, eq(resource.id, resourcePlacement.resourceId))
    .leftJoin(file, eq(file.id, resource.fileId))
    .leftJoin(
      resourceView,
      and(eq(resourceView.resourceId, resource.id), eq(resourceView.studentId, ctx.user.id)),
    )
    .where(and(...conditions))
    .orderBy(asc(resourcePlacement.position), asc(resourcePlacement.addedAt), asc(resource.id))

  const shared = new Map<string, number>()
  if (role === 'lecturer' && itemRows.length > 0) {
    const rows = await ctx.db
      .select({ resourceId: resourcePlacement.resourceId, n: count() })
      .from(resourcePlacement)
      .where(
        and(
          inArray(
            resourcePlacement.resourceId,
            itemRows.map((r) => r.id),
          ),
          ne(resourcePlacement.courseId, courseId),
        ),
      )
      .groupBy(resourcePlacement.resourceId)
    for (const r of rows) shared.set(r.resourceId, r.n)
  }

  const practice = await practiceByTopic(ctx.db, courseId, role)
  const itemsByTopic = new Map<string, NoteItem[]>()
  for (const r of itemRows) {
    const item: NoteItem = {
      id: r.id,
      kind: r.kind,
      title: r.title,
      host: r.url ? hostOf(r.url) : null,
      file: r.fileId ? { id: r.fileId, name: r.fileName!, mimeType: r.mimeType!, sizeBytes: r.sizeBytes! } : null,
      updatedAt: r.updatedAt,
      isNew: role === 'student' && r.viewed === null,
      sharedInCount: shared.get(r.id) ?? 0,
    }
    itemsByTopic.set(r.topicId, [...(itemsByTopic.get(r.topicId) ?? []), item])
  }

  const topics: NotesTopic[] = topicRows
    .map((t) => ({
      id: t.id,
      title: t.title,
      hidden: t.hidden,
      items: itemsByTopic.get(t.id) ?? [],
      practice: practice.get(t.id) ?? null,
    }))
    .filter((t) => !q || t.items.length > 0)

  const otherCourses =
    role === 'lecturer'
      ? (await listLecturerCourses(ctx))
          .filter((c) => c.id !== courseId)
          .map((c) => ({ id: c.id, label: label({ title: c.title, schoolName: c.schoolName, className: c.className }) }))
      : []
  return { role, course: summary, topics, otherCourses }
}

/**
 * The item as placed in this course, for a viewer who may see it: the lecturer of the course, or a
 * rostered student when the topic is not hidden. Everything else is FORBIDDEN.
 */
async function loadVisible(ctx: Ctx, courseId: string, resourceId: string) {
  await getCourse(ctx, courseId)
  const [row] = await ctx.db
    .select({
      id: resource.id,
      kind: resource.kind,
      title: resource.title,
      body: resource.body,
      url: resource.url,
      updatedAt: resource.updatedAt,
      fileId: file.id,
      fileName: file.name,
      mimeType: file.mimeType,
      sizeBytes: file.sizeBytes,
      topicId: courseTopic.id,
      topicTitle: courseTopic.title,
      topicHidden: courseTopic.hidden,
    })
    .from(resourcePlacement)
    .innerJoin(resource, eq(resource.id, resourcePlacement.resourceId))
    .innerJoin(courseTopic, eq(courseTopic.id, resourcePlacement.topicId))
    .leftJoin(file, eq(file.id, resource.fileId))
    .where(and(eq(resourcePlacement.courseId, courseId), eq(resourcePlacement.resourceId, resourceId)))
  if (!row || (ctx.user.role === 'student' && row.topicHidden)) forbidden()
  return row
}

async function recordView(ctx: Ctx, resourceId: string): Promise<void> {
  if (ctx.user.role !== 'student') return
  await ctx.db
    .insert(resourceView)
    .values({ resourceId, studentId: ctx.user.id, viewedAt: now() })
    .onConflictDoNothing()
}

export async function getNote(
  ctx: Ctx,
  courseId: string,
  resourceId: string,
): Promise<{
  id: string
  title: string
  body: Block[]
  updatedAt: Date
  topic: { id: string; title: string }
  practiceCount: number
  alsoIn: string[]
}> {
  const row = await loadVisible(ctx, courseId, resourceId)
  if (row.kind !== 'note') forbidden()
  await recordView(ctx, resourceId)
  const role = ctx.user.role === 'lecturer' ? 'lecturer' : 'student'
  const practice = await practiceByTopic(ctx.db, courseId, role)
  return {
    id: row.id,
    title: row.title,
    body: sanitizeRichText(row.body) ?? [],
    updatedAt: row.updatedAt,
    topic: { id: row.topicId, title: row.topicTitle },
    practiceCount: practice.get(row.topicId)?.count ?? 0,
    alsoIn: role === 'lecturer' ? await alsoInLabels(ctx.db, resourceId, courseId) : [],
  }
}

export async function openItem(
  ctx: Ctx,
  courseId: string,
  resourceId: string,
): Promise<{ kind: 'file'; fileId: string } | { kind: 'link'; url: string }> {
  const row = await loadVisible(ctx, courseId, resourceId)
  let target: { kind: 'file'; fileId: string } | { kind: 'link'; url: string }
  if (row.kind === 'file' && row.fileId) target = { kind: 'file', fileId: row.fileId }
  else if (row.kind === 'link' && row.url) target = { kind: 'link', url: row.url }
  else forbidden()
  await recordView(ctx, resourceId)
  return target
}

export async function getItemForEdit(
  ctx: Ctx,
  courseId: string,
  resourceId: string,
): Promise<{
  id: string
  kind: ResourceKind
  title: string
  body: Block[] | null
  url: string | null
  file: FileInfo | null
  topicId: string
  alsoIn: string[]
}> {
  await requireCourseOwner(ctx, courseId)
  const row = await loadVisible(ctx, courseId, resourceId)
  return {
    id: row.id,
    kind: row.kind,
    title: row.title,
    body: row.kind === 'note' ? (sanitizeRichText(row.body) ?? []) : null,
    url: row.url,
    file: row.fileId ? { id: row.fileId, name: row.fileName!, mimeType: row.mimeType!, sizeBytes: row.sizeBytes! } : null,
    topicId: row.topicId,
    alsoIn: await alsoInLabels(ctx.db, resourceId, courseId),
  }
}

export async function listCourseTopics(ctx: Ctx, courseId: string): Promise<{ id: string; title: string }[]> {
  await requireCourseOwner(ctx, courseId)
  return ctx.db
    .select({ id: courseTopic.id, title: courseTopic.title })
    .from(courseTopic)
    .where(eq(courseTopic.courseId, courseId))
    .orderBy(asc(courseTopic.position), asc(courseTopic.createdAt), asc(courseTopic.id))
}
