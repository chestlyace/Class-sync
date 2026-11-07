import { and, asc, eq, ilike } from 'drizzle-orm'
import { z } from 'zod'
import { AppError } from '@/server/core/errors'
import type { Ctx } from '@/server/core/context'
import { requireRole, requireVerified } from '@/server/core/guards'
import { class_, classLecturer, school } from '@/server/db/schema'
import { isUniqueViolation } from '@/server/lib/db-errors'
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

const createSchoolSchema = z.object({
  name: nameField,
  town: nameField,
  latitude: latitudeField.optional(),
  longitude: longitudeField.optional(),
  radiusM: radiusField.optional(),
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

/** Escape LIKE wildcards (and the escape character itself) so user input matches literally. */
function escapeLike(s: string): string {
  return s.replace(/[\\%_]/g, '\\$&')
}

export async function searchSchools(ctx: Ctx, query: string): Promise<School[]> {
  requireVerified(ctx)
  const q = query.trim()
  if (!q) return []
  const rows = await ctx.db
    .select()
    .from(school)
    .where(ilike(school.name, `%${escapeLike(q)}%`))
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

export async function setSchoolLocation(
  ctx: Ctx,
  schoolId: string,
  input: { latitude: number; longitude: number; radiusM?: number },
): Promise<School> {
  requireRole(ctx, 'lecturer')
  const data = parseInput(locationSchema, input)

  const [current] = await ctx.db.select().from(school).where(eq(school.id, schoolId))
  if (!current) throw new AppError('NOT_FOUND', 'School not found')

  if (current.createdBy !== ctx.user.id) {
    const [link] = await ctx.db
      .select({ classId: classLecturer.classId })
      .from(classLecturer)
      .innerJoin(class_, eq(class_.id, classLecturer.classId))
      .where(and(eq(classLecturer.userId, ctx.user.id), eq(class_.schoolId, schoolId)))
      .limit(1)
    if (!link) {
      throw new AppError(
        'FORBIDDEN',
        'Only the creator or a lecturer of a class at this school can set its location',
      )
    }
  }

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
