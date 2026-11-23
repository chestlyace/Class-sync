import { and, asc, eq } from 'drizzle-orm'
import type { Ctx } from '@/server/core/context'
import { now } from '@/server/core/clock'
import { AppError } from '@/server/core/errors'
import { requireRole } from '@/server/core/guards'
import { caTemplate, caTemplateDefault } from '@/server/db/schema'
import { isUniqueViolation } from '@/server/lib/db-errors'
import { requireCourseOwner } from '@/server/courses/service'
import { builtInSettings, isBuiltInTemplateId, validateSettings, type BuiltInTemplateId, type CaSettings } from './rules'
import { fromStored, groupNameFor, toStored } from './template-settings'
import { settingsError, writeCourseCa } from './write'

export { applyDefaultCaTemplate, groupNameFor } from './template-settings'

/** A template's name: 1 to 60 characters once trimmed, unique per lecturer (case ignored). */
export const TEMPLATE_NAME_MAX = 60
/** At most this many courses in one "apply to courses". */
const MAX_APPLY = 100

export type CaTemplate = { id: string; name: string; settings: CaSettings }

/** Which template a lecturer's new courses start with; null = the app's defaults. */
export type DefaultTemplate = { templateId: string } | { builtInId: BuiltInTemplateId } | null

/** A template picked by the user: one of theirs, or a built-in one. */
export type TemplateRef = { templateId: string } | { builtInId: BuiltInTemplateId }

function parseName(name: unknown): string {
  const trimmed = typeof name === 'string' ? name.trim() : ''
  if (trimmed === '' || trimmed.length > TEMPLATE_NAME_MAX) {
    throw new AppError('VALIDATION', 'Invalid template name', { fields: ['name'] })
  }
  return trimmed
}

async function requireOwnTemplate(ctx: Ctx, templateId: unknown) {
  if (typeof templateId !== 'string' || templateId === '' || templateId.length > 100) {
    throw new AppError('VALIDATION', 'Invalid input', { fields: ['templateId'] })
  }
  const [row] = await ctx.db
    .select()
    .from(caTemplate)
    .where(and(eq(caTemplate.id, templateId), eq(caTemplate.ownerId, ctx.user.id)))
  // Someone else's template looks the same as none.
  if (!row) throw new AppError('NOT_FOUND', 'No such template')
  return row
}

/** My templates (by name) and which one new courses start with. Lecturers only. */
export async function listCaTemplates(ctx: Ctx): Promise<{ templates: CaTemplate[]; defaultTemplate: DefaultTemplate }> {
  requireRole(ctx, 'lecturer')
  const [rows, [def]] = await Promise.all([
    ctx.db.select().from(caTemplate).where(eq(caTemplate.ownerId, ctx.user.id)).orderBy(asc(caTemplate.name)),
    ctx.db.select().from(caTemplateDefault).where(eq(caTemplateDefault.userId, ctx.user.id)),
  ])
  const templates = rows.map((r) => ({
    id: r.id,
    name: r.name,
    settings: { ...r.settings, groups: r.settings.groups.map((g) => ({ ...g, id: null })) },
  }))
  let defaultTemplate: DefaultTemplate = null
  if (def?.templateId) defaultTemplate = { templateId: def.templateId }
  else if (def?.builtInId && isBuiltInTemplateId(def.builtInId)) defaultTemplate = { builtInId: def.builtInId }
  return { templates, defaultTemplate }
}

/**
 * Saves settings as a new template of mine (checked like course settings). A name I already use
 * is CONFLICT name_taken.
 */
export async function createCaTemplate(ctx: Ctx, input: { name: unknown; settings: unknown }): Promise<CaTemplate> {
  requireRole(ctx, 'lecturer')
  const name = parseName(input.name)
  const parsed = validateSettings(input.settings)
  if ('error' in parsed) throw settingsError(parsed)
  try {
    const [row] = await ctx.db
      .insert(caTemplate)
      .values({ ownerId: ctx.user.id, name, settings: toStored(parsed) })
      .returning({ id: caTemplate.id })
    return { id: row.id, name, settings: { ...parsed, groups: parsed.groups.map((g) => ({ ...g, id: null })) } }
  } catch (err) {
    if (isUniqueViolation(err)) throw new AppError('CONFLICT', 'You already have a template with this name', { reason: 'name_taken' })
    throw err
  }
}

/** Deletes a template of mine; if new courses started with it, they get the app's defaults again. */
export async function deleteCaTemplate(ctx: Ctx, templateId: unknown): Promise<void> {
  requireRole(ctx, 'lecturer')
  const row = await requireOwnTemplate(ctx, templateId)
  await ctx.db.delete(caTemplate).where(eq(caTemplate.id, row.id))
}

/** Which template my new courses start with: one of mine, a built-in one, or null for the app's defaults. */
export async function setDefaultCaTemplate(ctx: Ctx, ref: unknown): Promise<DefaultTemplate> {
  requireRole(ctx, 'lecturer')
  const target = await resolveRef(ctx, ref, true)
  if (target === null) {
    await ctx.db.delete(caTemplateDefault).where(eq(caTemplateDefault.userId, ctx.user.id))
    return null
  }
  const values =
    'templateId' in target
      ? { templateId: target.templateId, builtInId: null }
      : { templateId: null, builtInId: target.builtInId }
  await ctx.db
    .insert(caTemplateDefault)
    .values({ userId: ctx.user.id, ...values })
    .onConflictDoUpdate({ target: caTemplateDefault.userId, set: { ...values, updatedAt: now() } })
  return target
}

/** A template reference from the client, checked: mine or built-in; null only when `allowNone`. */
async function resolveRef(ctx: Ctx, ref: unknown, allowNone: boolean): Promise<TemplateRef | null> {
  if (ref === null && allowNone) return null
  if (typeof ref === 'object' && ref !== null) {
    const r = ref as Record<string, unknown>
    if (isBuiltInTemplateId(r.builtInId)) return { builtInId: r.builtInId }
    if (r.templateId !== undefined) return { templateId: (await requireOwnTemplate(ctx, r.templateId)).id }
  }
  throw new AppError('VALIDATION', 'Invalid input', { fields: ['template'] })
}

/** The settings a template gives, built-in names in the user's language. */
async function settingsOf(ctx: Ctx, ref: TemplateRef): Promise<CaSettings> {
  if ('builtInId' in ref) return builtInSettings(ref.builtInId, groupNameFor(ctx.user.locale))
  return fromStored((await requireOwnTemplate(ctx, ref.templateId)).settings)
}

/**
 * Applies a template to courses I own (FORBIDDEN if any is not mine, before anything is written).
 * Each course gets the template's split; a named CA with the same name as one it has keeps its
 * tests. Returns how many courses were set.
 */
export async function applyCaTemplate(ctx: Ctx, ref: unknown, courseIds: unknown): Promise<number> {
  requireRole(ctx, 'lecturer')
  if (
    !Array.isArray(courseIds) ||
    courseIds.length === 0 ||
    courseIds.length > MAX_APPLY ||
    !courseIds.every((id) => typeof id === 'string' && id !== '' && id.length <= 100)
  ) {
    throw new AppError('VALIDATION', 'Pick at least one course', { fields: ['courseIds'] })
  }
  const target = (await resolveRef(ctx, ref, false))!
  const settings = await settingsOf(ctx, target)
  const ids = [...new Set(courseIds as string[])]
  for (const id of ids) await requireCourseOwner(ctx, id)
  for (const id of ids) await writeCourseCa(ctx.db, id, settings, ctx.user.id)
  return ids.length
}
