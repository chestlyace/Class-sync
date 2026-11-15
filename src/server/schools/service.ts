import { and, asc, eq, inArray, like, ne, sql } from 'drizzle-orm'
import { z } from 'zod'
import { AppError } from '@/server/core/errors'
import type { Ctx } from '@/server/core/context'
import { requireRole, requireVerified } from '@/server/core/guards'
import { class_, classLecturer, school } from '@/server/db/schema'
import type { Db } from '@/server/db'
import { isUniqueViolation } from '@/server/lib/db-errors'
import { containsPattern } from '@/server/lib/like'
import { normalizeKey } from '@/server/lib/normalize'

export type School = {
  id: string
  name: string
  town: string
  latitude: number | null
  longitude: number | null
  radiusM: number
}

const SEARCH_LIMIT = 20
const UNIQUE_CONSTRAINT = 'school_name_key_town_key_unique'

const nameField = z.string().trim().min(2).max(120)
const latitudeField = z.number().min(-90).max(90) // z.number() rejects NaN and Infinity
const longitudeField = z.number().min(-180).max(180)
const radiusField = z.number().int().min(50).max(5000)

const createSchoolSchema = z
  .object({
    name: nameField,
    town: nameField,
    latitude: latitudeField.optional(),
    longitude: longitudeField.optional(),
    radiusM: radiusField.optional(),
  })
  .superRefine((v, ctx) => {
    // Coordinates are all-or-nothing: a half-set location would break geofence checks.
    if (v.latitude !== undefined && v.longitude === undefined) {
      ctx.addIssue({ code: 'custom', path: ['longitude'], message: 'longitude is required with latitude' })
    }
    if (v.longitude !== undefined && v.latitude === undefined) {
      ctx.addIssue({ code: 'custom', path: ['latitude'], message: 'latitude is required with longitude' })
    }
  })

const locationSchema = z.object({
  latitude: latitudeField,
  longitude: longitudeField,
  radiusM: radiusField.optional(),
})

function parseInput<T extends z.ZodType>(schema: T, input: unknown): z.infer<T> {
  const result = schema.safeParse(input)
  if (!result.success) {
    const fields = [...new Set(result.error.issues.map((i) => i.path.join('.')))]
    throw new AppError('VALIDATION', 'Invalid input', { fields })
  }
  return result.data
}

/** True when the school has a check-in location, for read models that only need to know that. */
export const schoolHasLocation = sql<boolean>`(${school.latitude} is not null)`

function toSchool(row: typeof school.$inferSelect): School {
  return {
    id: row.id,
    name: row.name,
    town: row.town,
    latitude: row.latitude,
    longitude: row.longitude,
    radiusM: row.radiusM,
  }
}

export async function searchSchools(ctx: Ctx, query: string): Promise<School[]> {
  requireVerified(ctx)
  // Match on the normalised key, so case, spacing and accents don't matter ("ecole" finds "École").
  const q = normalizeKey(query)
  if (!q) return []
  const rows = await ctx.db
    .select()
    .from(school)
    .where(like(school.nameKey, containsPattern(q)))
    .orderBy(asc(school.nameKey), asc(school.id)) // nameKey: collation-independent, case-insensitive order
    .limit(SEARCH_LIMIT)
  return rows.map(toSchool)
}

export async function getSchool(ctx: Ctx, schoolId: string): Promise<School> {
  requireVerified(ctx)
  const [row] = await ctx.db.select().from(school).where(eq(school.id, schoolId))
  if (!row) throw new AppError('NOT_FOUND', 'School not found')
  return toSchool(row)
}

export async function createSchool(
  ctx: Ctx,
  input: {
    name: string
    town: string
    latitude?: number
    longitude?: number
    radiusM?: number
  },
): Promise<School> {
  requireRole(ctx, 'lecturer')
  const data = parseInput(createSchoolSchema, input)
  const nameKey = normalizeKey(data.name)
  const townKey = normalizeKey(data.town)

  try {
    const [row] = await ctx.db
      .insert(school)
      .values({
        name: data.name,
        town: data.town,
        nameKey,
        townKey,
        latitude: data.latitude,
        longitude: data.longitude,
        radiusM: data.radiusM, // undefined -> column default (500)
        createdBy: ctx.user.id,
      })
      .returning()
    return toSchool(row)
  } catch (err) {
    if (!isUniqueViolation(err, UNIQUE_CONSTRAINT)) throw err
    const [existing] = await ctx.db
      .select({ id: school.id })
      .from(school)
      .where(and(eq(school.nameKey, nameKey), eq(school.townKey, townKey)))
    if (!existing) throw err
    throw new AppError('CONFLICT', 'A school with this name already exists in this town', {
      existingSchoolId: existing.id,
    })
  }
}

/**
 * A school is shared by every lecturer with a class there: its creator or any of them may edit it.
 * An unknown school is NOT_FOUND (school ids are public through search anyway).
 */
async function requireSchoolEditor(ctx: Ctx, schoolId: string): Promise<void> {
  requireRole(ctx, 'lecturer')
  const [current] = await ctx.db.select({ createdBy: school.createdBy }).from(school).where(eq(school.id, schoolId))
  if (!current) throw new AppError('NOT_FOUND', 'School not found')
  if (current.createdBy === ctx.user.id) return
  const [link] = await ctx.db
    .select({ classId: classLecturer.classId })
    .from(classLecturer)
    .innerJoin(class_, eq(class_.id, classLecturer.classId))
    .where(and(eq(classLecturer.userId, ctx.user.id), eq(class_.schoolId, schoolId)))
    .limit(1)
  if (!link) {
    throw new AppError('FORBIDDEN', 'Only the creator or a lecturer of a class at this school can change it')
  }
}

const updateSchoolSchema = z.object({ name: nameField, town: nameField })

/** A validated name and town with their normalised keys, as a school row stores them. */
export type SchoolNames = { name: string; town: string; nameKey: string; townKey: string }

/** Validates a new name and town (VALIDATION) and derives the duplicate-detection keys. */
export function parseSchoolNames(input: unknown): SchoolNames {
  const data = parseInput(updateSchoolSchema, input)
  return { name: data.name, town: data.town, nameKey: normalizeKey(data.name), townKey: normalizeKey(data.town) }
}

function nameClash(existingSchoolId: string): AppError {
  return new AppError('CONFLICT', 'A school with this name already exists in this town', { existingSchoolId })
}

/**
 * Writes a new name and town onto the school. A clash with another school is CONFLICT, carrying
 * that school's id so the caller can point at it. The clash is looked for first, so this also
 * works inside a transaction (where a failed statement would abort it); the unique constraint
 * still catches a race outside one.
 */
export async function renameSchoolRow(db: Db, schoolId: string, names: SchoolNames): Promise<School | undefined> {
  const findClash = async () => {
    const [existing] = await db
      .select({ id: school.id })
      .from(school)
      .where(and(eq(school.nameKey, names.nameKey), eq(school.townKey, names.townKey), ne(school.id, schoolId)))
    return existing
  }
  const before = await findClash()
  if (before) throw nameClash(before.id)
  try {
    const [row] = await db.update(school).set(names).where(eq(school.id, schoolId)).returning()
    return row && toSchool(row)
  } catch (err) {
    if (!isUniqueViolation(err, UNIQUE_CONSTRAINT)) throw err
    const existing = await findClash()
    if (!existing) throw err
    throw nameClash(existing.id)
  }
}

/** Name and town, for everyone using the school. A clash with another school is CONFLICT. */
export async function updateSchool(ctx: Ctx, schoolId: string, input: { name: string; town: string }): Promise<School> {
  await requireSchoolEditor(ctx, schoolId)
  const row = await renameSchoolRow(ctx.db, schoolId, parseSchoolNames(input))
  if (!row) throw new AppError('NOT_FOUND', 'School not found')
  return row
}

/**
 * When one school is merged into another: the kept school takes the removed one's check-in
 * location (and radius) only if it has none of its own. Run inside the merge's transaction.
 */
export async function adoptLocationIfMissing(tx: Db, fromId: string, intoId: string): Promise<'kept' | 'adopted' | 'none'> {
  const rows = await tx
    .select({ id: school.id, latitude: school.latitude, longitude: school.longitude, radiusM: school.radiusM })
    .from(school)
    .where(inArray(school.id, [fromId, intoId]))
  const from = rows.find((r) => r.id === fromId)
  const into = rows.find((r) => r.id === intoId)
  if (into?.latitude != null) return 'kept'
  if (from?.latitude == null || from.longitude == null) return 'none'
  await tx
    .update(school)
    .set({ latitude: from.latitude, longitude: from.longitude, radiusM: from.radiusM })
    .where(eq(school.id, intoId))
  return 'adopted'
}

export async function setSchoolLocation(
  ctx: Ctx,
  schoolId: string,
  input: { latitude: number; longitude: number; radiusM?: number },
): Promise<School> {
  requireRole(ctx, 'lecturer')
  const data = parseInput(locationSchema, input)

  await requireSchoolEditor(ctx, schoolId)

  const [row] = await ctx.db
    .update(school)
    .set({
      latitude: data.latitude,
      longitude: data.longitude,
      ...(data.radiusM !== undefined ? { radiusM: data.radiusM } : {}),
    })
    .where(eq(school.id, schoolId))
    .returning()
  return toSchool(row)
}
