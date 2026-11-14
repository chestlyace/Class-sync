import { and, count, eq, ne } from 'drizzle-orm'
import { AppError } from '@/server/core/errors'
import type { Ctx } from '@/server/core/context'
import { requireRole } from '@/server/core/guards'
import type { Db } from '@/server/db'
import { class_, classLecturer, classStudent, course } from '@/server/db/schema'
import {
  deleteCoursesInTx,
  deletionImpact,
  removeOrphanedFiles,
  requireConfirmation,
  type DeletionImpact,
} from '@/server/courses/delete'
import { isClassLecturer } from './service'

/**
 * `delete`: I am the class's only lecturer, so the class goes, with its courses and memberships.
 * `leave`: colleagues teach it too, so only I go, with my own courses there.
 */
export type ClassRemoval = { mode: 'delete' | 'leave'; impact: DeletionImpact }

function forbidden(): never {
  throw new AppError('FORBIDDEN', 'Only a lecturer of this class can do this')
}

async function plan(db: Db, classId: string, userId: string) {
  const [[others], courses] = await Promise.all([
    db
      .select({ n: count() })
      .from(classLecturer)
      .where(and(eq(classLecturer.classId, classId), ne(classLecturer.userId, userId))),
    db.select({ id: course.id, lecturerId: course.lecturerId }).from(course).where(eq(course.classId, classId)),
  ])
  const mode: ClassRemoval['mode'] = Number(others.n) > 0 ? 'leave' : 'delete'
  const courseIds = courses.filter((c) => mode === 'delete' || c.lecturerId === userId).map((c) => c.id)
  return { mode, courseIds }
}

export async function getClassRemoval(ctx: Ctx, classId: string): Promise<ClassRemoval> {
  requireRole(ctx, 'lecturer')
  if (!(await isClassLecturer(ctx.db, classId, ctx.user.id))) forbidden()
  const { mode, courseIds } = await plan(ctx.db, classId, ctx.user.id)
  let students: number | null = null
  if (mode === 'delete') {
    const [row] = await ctx.db
      .select({ n: count() })
      .from(classStudent)
      .where(and(eq(classStudent.classId, classId), eq(classStudent.status, 'active')))
    students = Number(row.n)
  }
  return { mode, impact: await deletionImpact(ctx.db, courseIds, students) }
}

/**
 * Deletes the class or leaves it, decided here rather than by the caller: the class row is locked
 * first, so two colleagues leaving at once cannot both leave and strand its students.
 * `confirm` is the class name as typed.
 */
export async function removeClass(ctx: Ctx, classId: string, confirm: string): Promise<{ mode: 'delete' | 'leave' }> {
  requireRole(ctx, 'lecturer')
  const outcome = await ctx.db.transaction(async (tx) => {
    const [locked] = await tx.select({ name: class_.name }).from(class_).where(eq(class_.id, classId)).for('update')
    if (!locked || !(await isClassLecturer(tx, classId, ctx.user.id))) forbidden()
    requireConfirmation(locked.name, confirm)
    const { mode, courseIds } = await plan(tx, classId, ctx.user.id)
    const fileIds = await deleteCoursesInTx(tx, courseIds)
    if (mode === 'delete') {
      await tx.delete(class_).where(eq(class_.id, classId))
    } else {
      await tx
        .delete(classLecturer)
        .where(and(eq(classLecturer.classId, classId), eq(classLecturer.userId, ctx.user.id)))
    }
    return { mode, fileIds }
  })
  await removeOrphanedFiles(ctx.db, outcome.fileIds)
  return { mode: outcome.mode }
}
