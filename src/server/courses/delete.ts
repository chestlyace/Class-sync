import { and, count, countDistinct, eq, inArray, like, notExists, notInArray, or, sql } from 'drizzle-orm'
import { AppError } from '@/server/core/errors'
import type { Ctx } from '@/server/core/context'
import type { Db } from '@/server/db'
import {
  assignment,
  assignmentAttachment,
  attendanceSession,
  classExtra,
  classMeeting,
  classSlot,
  course,
  courseTest,
  file,
  onlineClassJoin,
  participationEvent,
  resource,
  resourcePlacement,
  revisionGroup,
  revisionQuestion,
  submission,
  submissionFile,
  testAttempt,
} from '@/server/db/schema'
import { getStorage } from '@/server/files/storage'
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
  /** Participation points (part of the CA). */
  participation: number
  practiceQuestions: number
  timetableSlots: number
  /** Notes and files that go with it; one also placed in a course that stays is not counted. */
  notes: number
}

async function countOf(query: Promise<{ n: number }[]>): Promise<number> {
  const [row] = await query
  return Number(row?.n ?? 0)
}

export async function deletionImpact(db: Db, courseIds: string[], students: number | null): Promise<DeletionImpact> {
  const none = { attendanceSessions: 0, assignments: 0, submissions: 0, tests: 0, testAttempts: 0, participation: 0, practiceQuestions: 0, timetableSlots: 0, notes: 0 }
  if (courseIds.length === 0) return { courses: 0, students, ...none }
  const keptElsewhere = db
    .select({ one: sql`1` })
    .from(resourcePlacement)
    .where(and(eq(resourcePlacement.resourceId, resource.id), notInArray(resourcePlacement.courseId, courseIds)))
  const [attendanceSessions, assignments, submissions, tests, testAttempts, participation, practiceQuestions, timetableSlots, notes] =
    await Promise.all([
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
      countOf(db.select({ n: count() }).from(participationEvent).where(inArray(participationEvent.courseId, courseIds))),
      countOf(
        db
          .select({ n: count() })
          .from(revisionQuestion)
          .innerJoin(revisionGroup, eq(revisionGroup.id, revisionQuestion.groupId))
          .where(inArray(revisionGroup.courseId, courseIds)),
      ),
      countOf(db.select({ n: count() }).from(classSlot).where(inArray(classSlot.courseId, courseIds))),
      countOf(
        db
          .select({ n: countDistinct(resource.id) })
          .from(resource)
          .innerJoin(resourcePlacement, eq(resourcePlacement.resourceId, resource.id))
          .where(and(inArray(resourcePlacement.courseId, courseIds), notExists(keptElsewhere))),
      ),
    ])
  return {
    courses: courseIds.length,
    students,
    attendanceSessions,
    assignments,
    submissions,
    tests,
    testAttempts,
    participation,
    practiceQuestions,
    timetableSlots,
    notes,
  }
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

  // Join and cached-meeting rows have no class FK: their keys point at slots and extras, so remove them by those ids.
  const [slots, extras] = await Promise.all([
    tx.select({ id: classSlot.id }).from(classSlot).where(inArray(classSlot.courseId, courseIds)),
    tx.select({ id: classExtra.id }).from(classExtra).where(inArray(classExtra.courseId, courseIds)),
  ])
  const joins = or(
    ...slots.map((s) => like(onlineClassJoin.occurrenceKey, `slot:${s.id}:%`)),
    ...extras.map((e) => eq(onlineClassJoin.occurrenceKey, `extra:${e.id}`)),
  )
  if (joins) await tx.delete(onlineClassJoin).where(joins)
  const meetings = or(
    ...slots.map((s) => like(classMeeting.occurrenceKey, `slot:${s.id}:%`)),
    ...extras.map((e) => eq(classMeeting.occurrenceKey, `extra:${e.id}`)),
  )
  if (meetings) await tx.delete(classMeeting).where(meetings)

  await tx.delete(course).where(inArray(course.id, courseIds))

  const fileIds = [
    ...attachments.map((a) => a.fileId),
    ...answers.map((a) => a.fileId),
    ...orphanedResources.flatMap((r) => (r.fileId ? [r.fileId] : [])),
  ]
  return [...new Set(fileIds)]
}

const REMOVE_BATCH = 20

/**
 * Removes the stored files that nothing references any more (an attachment, an answer or a note),
 * after the delete committed. One query finds them, objects go in parallel batches, rows in one
 * statement. It never throws: the delete already happened, so a cleanup failure is only logged.
 */
export async function removeOrphanedFiles(db: Db, fileIds: string[]): Promise<void> {
  if (fileIds.length === 0) return
  try {
    const unused = await db
      .select({ id: file.id, storageKey: file.storageKey })
      .from(file)
      .where(
        and(
          inArray(file.id, fileIds),
          notExists(db.select({ one: sql`1` }).from(assignmentAttachment).where(eq(assignmentAttachment.fileId, file.id))),
          notExists(db.select({ one: sql`1` }).from(submissionFile).where(eq(submissionFile.fileId, file.id))),
          notExists(db.select({ one: sql`1` }).from(resource).where(eq(resource.fileId, file.id))),
        ),
      )
    if (unused.length === 0) return
    const storage = getStorage()
    for (let i = 0; i < unused.length; i += REMOVE_BATCH) {
      await Promise.all(
        unused.slice(i, i + REMOVE_BATCH).map(async (f) => {
          try {
            await storage.remove(f.storageKey)
          } catch (err) {
            console.error('[courses] could not remove a stored object', f.storageKey, err)
          }
        }),
      )
    }
    await db.delete(file).where(
      inArray(
        file.id,
        unused.map((f) => f.id),
      ),
    )
  } catch (err) {
    console.error('[courses] could not clean up stored files after a delete', err)
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
