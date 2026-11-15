import { and, asc, eq, inArray, like, ne, or, sql, type SQL } from 'drizzle-orm'
import type { Ctx } from '@/server/core/context'
import { AppError } from '@/server/core/errors'
import { requireAdmin } from '@/server/core/guards'
import { deletionImpact, type DeletionImpact } from '@/server/courses/delete'
import type { Db } from '@/server/db'
import { class_, classLecturer, classStudent, course, school, user } from '@/server/db/schema'
import { containsPattern } from '@/server/lib/like'
import { normalizeKey } from '@/server/lib/normalize'
import { schoolHasLocation } from '@/server/schools/service'
import { ADMIN_PAGE_SIZE, countWhere, pageNumber, type Page } from './queries'

// The admin view of schools: every school with its classes, so duplicates made by lecturers who
// never met in the app can be found and fixed. Counts and names only (see fence.test.ts).

const MERGE_SEARCH_LIMIT = 20

export type SchoolSummary = { id: string; name: string; town: string; classes: number; hasLocation: boolean; createdAt: Date }
export type SchoolRow = SchoolSummary & { lecturers: number; students: number }
export type SchoolClass = {
  id: string
  name: string
  academicYear: string
  lecturers: { id: string; name: string }[]
  students: number
  courses: number
}
export type SchoolDetail = SchoolSummary & {
  radiusM: number
  creator: { id: string; name: string }
  classList: SchoolClass[]
  /** Other schools with the same town key: where duplicates usually hide. */
  sameTown: SchoolSummary[]
}

// Correlated subqueries name the outer row with its table: Drizzle leaves columns unqualified in a
// single-table select, and a bare "id" inside the subquery would mean the inner table's id.
const outerSchoolId = sql`${sql.identifier('school')}.${sql.identifier('id')}`
const outerClassId = sql`${sql.identifier('class')}.${sql.identifier('id')}`

const classCount = sql<number>`(select count(*) from ${class_} where ${class_.schoolId} = ${outerSchoolId})`.mapWith(Number)
const lecturerCount = sql<number>`(
  select count(distinct ${classLecturer.userId}) from ${classLecturer}
  inner join ${class_} on ${class_.id} = ${classLecturer.classId}
  where ${class_.schoolId} = ${outerSchoolId}
)`.mapWith(Number)
const activeStudentCount = sql<number>`(
  select count(distinct ${classStudent.userId}) from ${classStudent}
  inner join ${class_} on ${class_.id} = ${classStudent.classId}
  where ${class_.schoolId} = ${outerSchoolId} and ${classStudent.status} = 'active'
)`.mapWith(Number)
const classActiveStudents = sql<number>`(
  select count(*) from ${classStudent}
  where ${classStudent.classId} = ${outerClassId} and ${classStudent.status} = 'active'
)`.mapWith(Number)
const classCourses = sql<number>`(select count(*) from ${course} where ${course.classId} = ${outerClassId})`.mapWith(Number)

const summaryColumns = {
  id: school.id,
  name: school.name,
  town: school.town,
  classes: classCount,
  hasLocation: schoolHasLocation,
  createdAt: school.createdAt,
}

/** Name or town containing the query, compared on the normalised keys (case and accents ignored). */
function nameOrTown(query: string): SQL | undefined {
  const q = normalizeKey(query)
  if (!q) return undefined
  const pattern = containsPattern(q)
  return or(like(school.nameKey, pattern), like(school.townKey, pattern))
}

/** Every school, by town then name so same-town duplicates sit next to each other. */
export async function listSchools(ctx: Ctx, q: { search?: string; page: number }): Promise<Page<SchoolRow>> {
  requireAdmin(ctx)
  const where = q.search ? nameOrTown(q.search) : undefined
  const page = pageNumber(q.page)
  const [rows, total] = await Promise.all([
    ctx.db
      .select({ ...summaryColumns, lecturers: lecturerCount, students: activeStudentCount })
      .from(school)
      .where(where)
      .orderBy(asc(school.townKey), asc(school.nameKey), asc(school.id))
      .limit(ADMIN_PAGE_SIZE)
      .offset((page - 1) * ADMIN_PAGE_SIZE),
    countWhere(ctx.db, school, where),
  ])
  return { rows, total, page, pageSize: ADMIN_PAGE_SIZE }
}

async function classesOf(db: Db, schoolId: string): Promise<SchoolClass[]> {
  const [classes, lecturers] = await Promise.all([
    db
      .select({
        id: class_.id,
        name: class_.name,
        academicYear: class_.academicYear,
        students: classActiveStudents,
        courses: classCourses,
      })
      .from(class_)
      .where(eq(class_.schoolId, schoolId))
      .orderBy(asc(class_.name), asc(class_.academicYear), asc(class_.id)),
    db
      .select({ classId: classLecturer.classId, id: user.id, name: user.name })
      .from(classLecturer)
      .innerJoin(class_, eq(class_.id, classLecturer.classId))
      .innerJoin(user, eq(user.id, classLecturer.userId))
      .where(eq(class_.schoolId, schoolId))
      .orderBy(asc(user.name), asc(user.id)),
  ])
  return classes.map((c) => ({
    ...c,
    lecturers: lecturers.filter((l) => l.classId === c.id).map(({ id, name }) => ({ id, name })),
  }))
}

export async function getSchoolDetail(ctx: Ctx, id: string): Promise<SchoolDetail> {
  requireAdmin(ctx)
  const [row] = await ctx.db
    .select({
      ...summaryColumns,
      townKey: school.townKey,
      radiusM: school.radiusM,
      creatorId: user.id,
      creatorName: user.name,
    })
    .from(school)
    .innerJoin(user, eq(user.id, school.createdBy))
    .where(eq(school.id, id))
  if (!row) throw new AppError('NOT_FOUND', 'School not found')
  const { townKey, creatorId, creatorName, ...summary } = row
  const [classList, sameTown] = await Promise.all([
    classesOf(ctx.db, id),
    ctx.db
      .select(summaryColumns)
      .from(school)
      .where(and(eq(school.townKey, townKey), ne(school.id, id)))
      .orderBy(asc(school.nameKey), asc(school.id)),
  ])
  return { ...summary, creator: { id: creatorId, name: creatorName }, classList, sameTown }
}

/** Schools to merge with, by name or town (towns are often spelled differently), never itself. */
export async function searchSchoolsForMerge(ctx: Ctx, query: string, excludeId: string): Promise<SchoolSummary[]> {
  requireAdmin(ctx)
  const match = nameOrTown(query)
  if (!match) return []
  return ctx.db
    .select(summaryColumns)
    .from(school)
    .where(and(match, ne(school.id, excludeId)))
    .orderBy(asc(school.townKey), asc(school.nameKey), asc(school.id))
    .limit(MERGE_SEARCH_LIMIT)
}

/** The classes at the school, the courses in them and the distinct students active in them. */
export async function schoolContents(db: Db, schoolId: string): Promise<{ classIds: string[]; courseIds: string[]; students: number }> {
  const classes = await db.select({ id: class_.id }).from(class_).where(eq(class_.schoolId, schoolId))
  const classIds = classes.map((c) => c.id)
  if (classIds.length === 0) return { classIds, courseIds: [], students: 0 }
  const [courses, [students]] = await Promise.all([
    db.select({ id: course.id }).from(course).where(inArray(course.classId, classIds)),
    db
      .select({ n: sql<number>`count(distinct ${classStudent.userId})`.mapWith(Number) })
      .from(classStudent)
      .where(and(inArray(classStudent.classId, classIds), eq(classStudent.status, 'active'))),
  ])
  return { classIds, courseIds: courses.map((c) => c.id), students: students.n }
}

/** What deleting the school would take with it, for the warning before the delete. */
export async function getSchoolDeletion(ctx: Ctx, id: string): Promise<{ classes: number; impact: DeletionImpact }> {
  requireAdmin(ctx)
  const [found] = await ctx.db.select({ id: school.id }).from(school).where(eq(school.id, id))
  if (!found) throw new AppError('NOT_FOUND', 'School not found')
  const { classIds, courseIds, students } = await schoolContents(ctx.db, id)
  return { classes: classIds.length, impact: await deletionImpact(ctx.db, courseIds, students) }
}
