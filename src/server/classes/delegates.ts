import { and, asc, eq } from 'drizzle-orm'
import type { Ctx } from '@/server/core/context'
import { AppError } from '@/server/core/errors'
import { requireRole } from '@/server/core/guards'
import type { Db } from '@/server/db'
import { class_, classDelegate, classStudent, course, user } from '@/server/db/schema'
import { isOnCourseRoster } from '@/server/courses/roster'
import { isClassLecturer } from './service'

/** A delegate and a deputy: enough for attendance to happen when one is away. */
export const MAX_DELEGATES = 2

export type ClassDelegate = { studentId: string; name: string }

async function requireClassLecturer(ctx: Ctx, classId: string): Promise<void> {
  requireRole(ctx, 'lecturer')
  // Same error for "no such class" and "not your class".
  if (typeof classId !== 'string' || !(await isClassLecturer(ctx.db, classId, ctx.user.id))) {
    throw new AppError('FORBIDDEN', 'Only a lecturer of this class can do this')
  }
}

/** Delegates whose rights hold: still active students of the class. */
const activeDelegates = (db: Db, classId: string) =>
  db
    .select({ studentId: classDelegate.studentId, name: user.name })
    .from(classDelegate)
    .innerJoin(
      classStudent,
      and(eq(classStudent.classId, classDelegate.classId), eq(classStudent.userId, classDelegate.studentId)),
    )
    .innerJoin(user, eq(user.id, classDelegate.studentId))
    .where(and(eq(classDelegate.classId, classId), eq(classStudent.status, 'active')))
    .orderBy(asc(classDelegate.appointedAt))

/**
 * The class's delegates, oldest first. Lecturers of the class and its active students may ask
 * (students see who their delegates are); anyone else is FORBIDDEN.
 */
export async function listClassDelegates(ctx: Ctx, classId: string): Promise<ClassDelegate[]> {
  requireRole(ctx, ctx.user.role)
  const allowed =
    ctx.user.role === 'lecturer'
      ? await isClassLecturer(ctx.db, classId, ctx.user.id)
      : (
          await ctx.db
            .select({ userId: classStudent.userId })
            .from(classStudent)
            .where(
              and(eq(classStudent.classId, classId), eq(classStudent.userId, ctx.user.id), eq(classStudent.status, 'active')),
            )
        ).length > 0
  if (!allowed) throw new AppError('FORBIDDEN', 'Not a member of this class')
  return activeDelegates(ctx.db, classId)
}

/**
 * Makes an active student of the class one of its delegates. Any lecturer of the class may.
 * Already a delegate: nothing changes. A third delegate is CONFLICT max_delegates; someone who
 * isn't an active student of the class is VALIDATION.
 */
export async function appointDelegate(ctx: Ctx, classId: string, studentId: string): Promise<void> {
  await requireClassLecturer(ctx, classId)
  const [member] = await ctx.db
    .select({ userId: classStudent.userId })
    .from(classStudent)
    .where(and(eq(classStudent.classId, classId), eq(classStudent.userId, studentId), eq(classStudent.status, 'active')))
  if (!member) throw new AppError('VALIDATION', 'Not a student of this class', { fields: ['studentId'] })

  await ctx.db.transaction(async (tx) => {
    // Lock the class: two lecturers appointing at once take turns, so the limit holds.
    await tx.select({ id: class_.id }).from(class_).where(eq(class_.id, classId)).for('update')
    const current = await activeDelegates(tx, classId)
    if (current.some((d) => d.studentId === studentId)) return
    if (current.length >= MAX_DELEGATES) {
      throw new AppError('CONFLICT', 'This class already has its delegates', { reason: 'max_delegates' })
    }
    // A former delegate who left the class and came back is appointed afresh.
    await tx
      .delete(classDelegate)
      .where(and(eq(classDelegate.classId, classId), eq(classDelegate.studentId, studentId)))
    await tx.insert(classDelegate).values({ classId, studentId, appointedBy: ctx.user.id })
  })
}

/** Ends a student's role as delegate of the class. Any lecturer of the class may; idempotent. */
export async function removeDelegate(ctx: Ctx, classId: string, studentId: string): Promise<void> {
  await requireClassLecturer(ctx, classId)
  await ctx.db.delete(classDelegate).where(and(eq(classDelegate.classId, classId), eq(classDelegate.studentId, studentId)))
}

/**
 * Whether this student may run attendance for the course: a delegate of its class, still an
 * active student there, and on the course's roster (not excluded from it).
 */
export async function isCourseDelegate(db: Db, studentId: string, courseId: string): Promise<boolean> {
  const [row] = await db
    .select({ classId: course.classId })
    .from(course)
    .innerJoin(classDelegate, and(eq(classDelegate.classId, course.classId), eq(classDelegate.studentId, studentId)))
    .innerJoin(
      classStudent,
      and(
        eq(classStudent.classId, course.classId),
        eq(classStudent.userId, studentId),
        eq(classStudent.status, 'active'),
      ),
    )
    .where(eq(course.id, courseId))
  return row !== undefined && (await isOnCourseRoster(db, courseId, studentId))
}

/** The classes where I (a student) am a delegate now. */
export async function myDelegateClassIds(ctx: Ctx): Promise<string[]> {
  if (ctx.user.role !== 'student') return []
  const rows = await ctx.db
    .select({ classId: classDelegate.classId })
    .from(classDelegate)
    .innerJoin(
      classStudent,
      and(eq(classStudent.classId, classDelegate.classId), eq(classStudent.userId, classDelegate.studentId)),
    )
    .where(and(eq(classDelegate.studentId, ctx.user.id), eq(classStudent.status, 'active')))
  return rows.map((r) => r.classId)
}
