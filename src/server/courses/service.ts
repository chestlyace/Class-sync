import { and, asc, desc, eq, ilike, inArray, or, sql } from 'drizzle-orm'
import { z } from 'zod'
import { AppError } from '@/server/core/errors'
import type { Ctx } from '@/server/core/context'
import { requireRole } from '@/server/core/guards'
import type { Db } from '@/server/db'
import { class_, classStudent, course, courseRosterAdjustment, school, user } from '@/server/db/schema'
import { isClassLecturer, type RosterEntry } from '@/server/classes/service'
import { containsPattern } from '@/server/lib/like'
import { courseRosterQuery, isOnCourseRoster as isOnRoster, rosteredCourseIds } from './roster'

export type CourseSummary = {
  id: string
  title: string
  code: string | null
  semester: number
  classId: string
  className: string
  schoolId: string
  schoolName: string
  lecturerName: string
}

export { isOnRoster as isOnCourseRoster }

/** A student who could be included in a course. No email: they may be outside my own classes. */
export type IncludeCandidate = { studentId: string; name: string; matricule: string }

const STUDENT_SEARCH_MIN = 2
const STUDENT_SEARCH_LIMIT = 20

const createCourseSchema = z.object({
  classId: z.string().min(1),
  title: z.string().trim().min(2).max(120),
  // Optional; blank means "no code". Stored uppercase.
  code: z
    .string()
    .trim()
    .max(20)
    .optional()
    .transform((c) => (c ? c.toUpperCase() : null)),
  semester: z.union([z.literal(1), z.literal(2), z.literal(3)]),
})

function parseCreateInput(input: unknown) {
  const result = createCourseSchema.safeParse(input)
  if (!result.success) {
    const fields = [...new Set(result.error.issues.map((i) => i.path.join('.')))]
    throw new AppError('VALIDATION', 'Invalid input', { fields })
  }
  return result.data
}

const summarySelection = {
  id: course.id,
  title: course.title,
  code: course.code,
  semester: course.semester,
  classId: class_.id,
  className: class_.name,
  schoolId: school.id,
  schoolName: school.name,
  lecturerName: user.name,
  lecturerId: course.lecturerId,
}

type SummaryRow = CourseSummary & { lecturerId: string }

function toSummary(row: SummaryRow): CourseSummary {
  return {
    id: row.id,
    title: row.title,
    code: row.code,
    semester: row.semester,
    classId: row.classId,
    className: row.className,
    schoolId: row.schoolId,
    schoolName: row.schoolName,
    lecturerName: row.lecturerName,
  }
}

function selectSummaries(db: Db) {
  return db
    .select(summarySelection)
    .from(course)
    .innerJoin(class_, eq(class_.id, course.classId))
    .innerJoin(school, eq(school.id, class_.schoolId))
    .innerJoin(user, eq(user.id, course.lecturerId))
}

const summaryOrder = [asc(school.name), asc(class_.name), asc(course.title), asc(course.id)]

async function loadSummary(db: Db, courseId: string): Promise<SummaryRow | undefined> {
  const [row] = await selectSummaries(db).where(eq(course.id, courseId))
  return row
}

export async function createCourse(
  ctx: Ctx,
  input: { classId: string; title: string; code?: string; semester: 1 | 2 | 3 },
): Promise<CourseSummary> {
  requireRole(ctx, 'lecturer')
  const data = parseCreateInput(input)
  // Same error for "no such class" and "not your class": ids are not probed.
  if (!(await isClassLecturer(ctx.db, data.classId, ctx.user.id))) {
    throw new AppError('FORBIDDEN', 'Only a lecturer of this class can create a course in it')
  }
  const [created] = await ctx.db
    .insert(course)
    .values({
      classId: data.classId,
      lecturerId: ctx.user.id,
      title: data.title,
      code: data.code,
      semester: data.semester,
    })
    .returning({ id: course.id })
  const row = await loadSummary(ctx.db, created.id)
  if (!row) throw new Error('Course vanished after creation')
  return toSummary(row)
}

export async function listLecturerCourses(ctx: Ctx): Promise<CourseSummary[]> {
  requireRole(ctx, 'lecturer')
  const rows = await selectSummaries(ctx.db)
    .where(eq(course.lecturerId, ctx.user.id))
    .orderBy(...summaryOrder)
  return rows.map(toSummary)
}

export async function listStudentCourses(ctx: Ctx): Promise<CourseSummary[]> {
  requireRole(ctx, 'student')
  const ids = await rosteredCourseIds(ctx.db, ctx.user.id)
  if (ids.length === 0) return []
  const rows = await selectSummaries(ctx.db)
    .where(inArray(course.id, ids))
    .orderBy(...summaryOrder)
  return rows.map(toSummary)
}

/**
 * Owner lecturer or rostered student. "No such course" and "not yours" are both FORBIDDEN, so
 * course ids cannot be probed (and a colleague sharing the class learns nothing about my courses).
 */
export async function getCourse(ctx: Ctx, courseId: string): Promise<CourseSummary> {
  requireRole(ctx, ctx.user.role)
  const row = await loadSummary(ctx.db, courseId)
  const allowed =
    row !== undefined &&
    (ctx.user.role === 'lecturer'
      ? row.lecturerId === ctx.user.id
      : await isOnRoster(ctx.db, courseId, ctx.user.id))
  if (!row || !allowed) throw new AppError('FORBIDDEN', 'You do not have access to this course')
  return toSummary(row)
}

/**
 * Owner-only gate for the course. Nonexistent and not-owned are both FORBIDDEN (see getCourse).
 * Used by the attendance and assignments features.
 */
export async function requireCourseOwner(ctx: Ctx, courseId: string): Promise<CourseSummary> {
  requireRole(ctx, 'lecturer')
  const row = await loadSummary(ctx.db, courseId)
  if (!row || row.lecturerId !== ctx.user.id) {
    throw new AppError('FORBIDDEN', 'Only the lecturer of this course can do this')
  }
  return toSummary(row)
}

export async function getCourseRoster(
  ctx: Ctx,
  courseId: string,
): Promise<(RosterEntry & { source: 'class' | 'included' })[]> {
  await requireCourseOwner(ctx, courseId)
  const rows = await courseRosterQuery(ctx.db, { courseId })
  return rows.map(({ studentId, name, email, matricule, source }) => ({
    studentId,
    name,
    email,
    matricule,
    source,
  }))
}

function invalid(field: string, message: string): never {
  throw new AppError('VALIDATION', message, { fields: [field] })
}

async function isActiveInClass(db: Db, classId: string, studentId: string): Promise<boolean> {
  const [row] = await db
    .select({ userId: classStudent.userId })
    .from(classStudent)
    .where(
      and(
        eq(classStudent.classId, classId),
        eq(classStudent.userId, studentId),
        eq(classStudent.status, 'active'),
      ),
    )
    .limit(1)
  return row !== undefined
}

async function isActiveAtSchool(db: Db, schoolId: string, studentId: string): Promise<boolean> {
  const [row] = await db
    .select({ userId: classStudent.userId })
    .from(classStudent)
    .innerJoin(class_, eq(class_.id, classStudent.classId))
    .where(
      and(
        eq(class_.schoolId, schoolId),
        eq(classStudent.userId, studentId),
        eq(classStudent.status, 'active'),
      ),
    )
    .limit(1)
  return row !== undefined
}

export async function setRosterAdjustment(
  ctx: Ctx,
  courseId: string,
  studentId: string,
  kind: 'include' | 'exclude' | null,
): Promise<void> {
  const owned = await requireCourseOwner(ctx, courseId)

  if (kind === null) {
    // Idempotent: clearing an adjustment that does not exist is not an error.
    await ctx.db
      .delete(courseRosterAdjustment)
      .where(and(eq(courseRosterAdjustment.courseId, courseId), eq(courseRosterAdjustment.studentId, studentId)))
    return
  }
  if (kind !== 'include' && kind !== 'exclude') invalid('kind', 'Invalid adjustment kind')

  const [target] = await ctx.db.select({ role: user.role }).from(user).where(eq(user.id, studentId))
  if (!target || target.role !== 'student') invalid('studentId', 'Not a student')

  if (kind === 'exclude') {
    if (!(await isActiveInClass(ctx.db, owned.classId, studentId))) {
      invalid('studentId', 'Only an active student of the class can be excluded')
    }
  } else {
    if (await isActiveInClass(ctx.db, owned.classId, studentId)) {
      invalid('studentId', 'Student is already in the class')
    }
    if (!(await isActiveAtSchool(ctx.db, owned.schoolId, studentId))) {
      invalid('studentId', 'Student is not in any class at this school')
    }
  }

  await ctx.db
    .insert(courseRosterAdjustment)
    .values({ courseId, studentId, kind, createdBy: ctx.user.id })
    .onConflictDoUpdate({
      target: [courseRosterAdjustment.courseId, courseRosterAdjustment.studentId],
      set: { kind, createdBy: ctx.user.id, createdAt: sql`now()` },
    })
}

/**
 * Students the course owner could include: active in any class at the course's school, not in
 * the course's own class (they are managed with exclude/restore) and not already included.
 * Matches name or any of their matricules at the school, case-insensitively; at least 2
 * characters. Each student appears once, with their most recent matricule at the school (the
 * same pick as the roster query).
 */
export async function searchSchoolStudentsForCourse(
  ctx: Ctx,
  courseId: string,
  query: string,
): Promise<IncludeCandidate[]> {
  const owned = await requireCourseOwner(ctx, courseId)
  const q = query.trim()
  if (q.length < STUDENT_SEARCH_MIN) return []
  const pattern = containsPattern(q)

  // One row per student active at the school: their most recent membership there.
  const membership = ctx.db
    .selectDistinctOn([classStudent.userId], { studentId: classStudent.userId, matricule: classStudent.matricule })
    .from(classStudent)
    .innerJoin(class_, eq(class_.id, classStudent.classId))
    .where(and(eq(class_.schoolId, owned.schoolId), eq(classStudent.status, 'active')))
    .orderBy(classStudent.userId, desc(classStudent.joinedAt), asc(classStudent.classId))
    .as('membership')

  const matriculeMatches = sql`exists (
    select 1 from ${classStudent} as m
    inner join ${class_} as mc on mc.id = m.class_id
    where m.user_id = ${user.id} and m.status = 'active' and mc.school_id = ${owned.schoolId}
      and m.matricule ilike ${pattern}
  )`
  const inCourseClass = sql`exists (
    select 1 from ${classStudent} as own
    where own.class_id = ${owned.classId} and own.user_id = ${user.id} and own.status = 'active'
  )`
  // Every candidate is active at the school, so an include row means "already on the roster".
  const alreadyIncluded = sql`exists (
    select 1 from ${courseRosterAdjustment} as adj
    where adj.course_id = ${courseId} and adj.student_id = ${user.id} and adj.kind = 'include'
  )`

  return ctx.db
    .select({ studentId: user.id, name: user.name, matricule: membership.matricule })
    .from(membership)
    .innerJoin(user, eq(user.id, membership.studentId))
    .where(
      and(
        eq(user.role, 'student'),
        or(ilike(user.name, pattern), matriculeMatches),
        sql`not ${inCourseClass}`,
        sql`not ${alreadyIncluded}`,
      ),
    )
    .orderBy(asc(sql`lower(${user.name})`), asc(membership.matricule), asc(user.id))
    .limit(STUDENT_SEARCH_LIMIT)
}
