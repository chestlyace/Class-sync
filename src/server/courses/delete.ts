import { and, count, countDistinct, eq, inArray, notExists, sql } from 'drizzle-orm'
import { AppError } from '@/server/core/errors'
import type { Ctx } from '@/server/core/context'
import type { Db } from '@/server/db'
import {
  assignment,
  assignmentAttachment,
  attendanceSession,
  course,
  courseTest,
  resource,
  resourcePlacement,
  revisionGroup,
  submission,
  submissionFile,
  testAttempt,
} from '@/server/db/schema'
import { deleteStoredFile } from '@/server/files/service'
import { courseRosterQuery } from './roster'
import { requireCourseOwner } from './service'

/** What a removal takes with it, for the warning shown before it. */
export type DeletionImpact = {
  courses: number
  /** Students who lose the course or class; null when none do (a lecturer leaving a class). */
  students: number | null
  attendanceSessions: number
  assignments: number
  submissions: number
  tests: number
  testAttempts: number
  notes: number
}

async function countOf(query: Promise<{ n: number }[]>): Promise<number> {
  const [row] = await query
  return Number(row?.n ?? 0)
}

export async function deletionImpact(db: Db, courseIds: string[], students: number | null): Promise<DeletionImpact> {
  if (courseIds.length === 0) {
    return { courses: 0, students, attendanceSessions: 0, assignments: 0, submissions: 0, tests: 0, testAttempts: 0, notes: 0 }
  }
  const [attendanceSessions, assignments, submissions, tests, testAttempts, notes] = await Promise.all([
    countOf(db.select({ n: count() }).from(attendanceSession).where(inArray(attendanceSession.courseId, courseIds))),
    countOf(db.select({ n: count() }).from(assignment).where(inArray(assignment.courseId, courseIds))),
    countOf(
      db
        .select({ n: count() })
        .from(submission)
        .innerJoin(assignment, eq(assignment.id, submission.assignmentId))
        .where(inArray(assignment.courseId, courseIds)),
    ),
    countOf(db.select({ n: count() }).from(courseTest).where(inArray(courseTest.courseId, courseIds))),
    countOf(
      db
        .select({ n: count() })
        .from(testAttempt)
        .innerJoin(courseTest, eq(courseTest.id, testAttempt.testId))
        .where(inArray(courseTest.courseId, courseIds)),
    ),
    countOf(
      db
        .select({ n: countDistinct(resourcePlacement.resourceId) })
        .from(resourcePlacement)
        .where(inArray(resourcePlacement.courseId, courseIds)),
    ),
  ])
  return { courses: courseIds.length, students, attendanceSessions, assignments, submissions, tests, testAttempts, notes }
}

/**
 * Deletes the courses and everything under them, inside the caller's transaction. Returns the ids
 * of stored files that may now be unused: pass them to removeOrphanedFiles after the commit.
 *
 * Notes topics are ON DELETE RESTRICT from note placements and practice groups, so those go first;
 * a note placed in another course survives, one placed only here goes with its file.
 */
export async function deleteCoursesInTx(tx: Db, courseIds: string[]): Promise<string[]> {
  if (courseIds.length === 0) return []
  const attachments = await tx
    .select({ fileId: assignmentAttachment.fileId })
    .from(assignmentAttachment)
    .innerJoin(assignment, eq(assignment.id, assignmentAttachment.assignmentId))
    .where(inArray(assignment.courseId, courseIds))
  const answers = await tx
    .select({ fileId: submissionFile.fileId })
    .from(submissionFile)
    .innerJoin(submission, eq(submission.id, submissionFile.submissionId))
    .innerJoin(assignment, eq(assignment.id, submission.assignmentId))
    .where(inArray(assignment.courseId, courseIds))

  await tx.delete(revisionGroup).where(inArray(revisionGroup.courseId, courseIds))
  const placed = await tx
    .delete(resourcePlacement)
    .where(inArray(resourcePlacement.courseId, courseIds))
    .returning({ resourceId: resourcePlacement.resourceId })
  const placedIds = [...new Set(placed.map((p) => p.resourceId))]
  const orphanedResources =
    placedIds.length === 0
      ? []
      : await tx
          .delete(resource)
          .where(
            and(
              inArray(resource.id, placedIds),
              notExists(tx.select({ one: sql`1` }).from(resourcePlacement).where(eq(resourcePlacement.resourceId, resource.id))),
            ),
          )
          .returning({ fileId: resource.fileId })

  await tx.delete(course).where(inArray(course.id, courseIds))

  const fileIds = [
    ...attachments.map((a) => a.fileId),
    ...answers.map((a) => a.fileId),
    ...orphanedResources.flatMap((r) => (r.fileId ? [r.fileId] : [])),
  ]
  return [...new Set(fileIds)]
}

/** Removes each stored file that nothing references any more (an attachment, an answer or a note). */
export async function removeOrphanedFiles(db: Db, fileIds: string[]): Promise<void> {
  for (const fileId of fileIds) {
    const [used] = await Promise.all([
      db.select({ one: sql`1` }).from(assignmentAttachment).where(eq(assignmentAttachment.fileId, fileId)).limit(1),
      db.select({ one: sql`1` }).from(submissionFile).where(eq(submissionFile.fileId, fileId)).limit(1),
      db.select({ one: sql`1` }).from(resource).where(eq(resource.fileId, fileId)).limit(1),
    ]).then((results) => results.filter((rows) => rows.length > 0))
    if (!used) await deleteStoredFile(db, fileId)
  }
}

/** Shared by course and class removal: the typed name must match, ignoring case and outer spaces. */
export function requireConfirmation(expected: string, typed: string): void {
  if (typeof typed !== 'string' || typed.trim().toLowerCase() !== expected.trim().toLowerCase()) {
    throw new AppError('VALIDATION', 'Type the name to confirm', { fields: ['confirm'] })
  }
}

export async function getCourseDeletionImpact(ctx: Ctx, courseId: string): Promise<DeletionImpact> {
  await requireCourseOwner(ctx, courseId)
  const roster = await courseRosterQuery(ctx.db, { courseId })
  return deletionImpact(ctx.db, [courseId], roster.length)
}

/** Owner only. `confirm` is the course title as the lecturer typed it. */
export async function deleteCourse(ctx: Ctx, courseId: string, confirm: string): Promise<void> {
  const summary = await requireCourseOwner(ctx, courseId)
  requireConfirmation(summary.title, confirm)
  const fileIds = await ctx.db.transaction(async (tx) => {
    const [locked] = await tx
      .select({ lecturerId: course.lecturerId })
      .from(course)
      .where(eq(course.id, courseId))
      .for('update')
    if (!locked || locked.lecturerId !== ctx.user.id) {
      throw new AppError('FORBIDDEN', 'Only the lecturer of this course can do this')
    }
    return deleteCoursesInTx(tx, [courseId])
  })
  await removeOrphanedFiles(ctx.db, fileIds)
}
