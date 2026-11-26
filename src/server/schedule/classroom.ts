import { eq, inArray } from 'drizzle-orm'
import { googleMeetAccess, googleMeetAccessToken } from '@/server/auth/google-meet-access'
import type { Ctx } from '@/server/core/context'
import { AppError } from '@/server/core/errors'
import { requireCourseOwner } from '@/server/courses/service'
import type { Db } from '@/server/db'
import { courseClassroom } from '@/server/db/schema'
import { canUseClassroom } from './classroom-switch'
import { createMeetSpace, MeetPermissionError, type MeetSpace } from './meet-api'

/** The one Google Meet room of a course, created through the course owner's own Google account. */
export type Classroom = {
  meetingUrl: string
  meetingCode: string
  knockingConfirmed: boolean
  createdAt: Date
}

/**
 * What a lecturer's online-class form can offer for a course's classroom: nothing (switch off), the classroom ready to
 * use, or a "Create the classroom" button. `googleGranted` says whether Google already allows Clasync to make rooms.
 */
export type ClassroomOption =
  | { state: 'hidden' }
  | { state: 'ready'; courseId: string; knockingConfirmed: boolean }
  | { state: 'missing'; courseId: string; googleGranted: boolean }

export type CreateClassroomResult = { kind: 'ready'; classroom: Classroom } | { kind: 'needsGoogle' }

type SpaceMaker = (accessToken: string) => Promise<MeetSpace>

let makerForTests: SpaceMaker | null = null

/** Replaces the Google call (token in, space out) so tests never reach the network. Pass null to restore. */
export function setMeetSpaceMakerForTests(fn: SpaceMaker | null): void {
  makerForTests = fn
}

export async function getClassroom(db: Db, courseId: string): Promise<Classroom | null> {
  const [row] = await db
    .select({
      meetingUrl: courseClassroom.meetingUrl,
      meetingCode: courseClassroom.meetingCode,
      knockingConfirmed: courseClassroom.knockingConfirmed,
      createdAt: courseClassroom.createdAt,
    })
    .from(courseClassroom)
    .where(eq(courseClassroom.courseId, courseId))
  return row ?? null
}

/** The classroom option of each course, for the signed-in lecturer's forms. Reads only: never calls Google. */
export async function classroomOptions(ctx: Ctx, courseIds: string[]): Promise<Record<string, ClassroomOption>> {
  const options: Record<string, ClassroomOption> = {}
  if (!canUseClassroom(ctx.user) || courseIds.length === 0) {
    for (const id of courseIds) options[id] = { state: 'hidden' }
    return options
  }
  const rows = await ctx.db
    .select({ courseId: courseClassroom.courseId, knockingConfirmed: courseClassroom.knockingConfirmed })
    .from(courseClassroom)
    .where(inArray(courseClassroom.courseId, courseIds))
  const ready = new Map(rows.map((r) => [r.courseId, r.knockingConfirmed]))
  const googleGranted =
    courseIds.some((id) => !ready.has(id)) && ((await googleMeetAccess(ctx.db, ctx.user.id))?.granted ?? false)
  for (const courseId of courseIds) {
    const knockingConfirmed = ready.get(courseId)
    options[courseId] =
      knockingConfirmed === undefined
        ? { state: 'missing', courseId, googleGranted }
        : { state: 'ready', courseId, knockingConfirmed }
  }
  return options
}

/** One course's classroom option (see `classroomOptions`). */
export async function classroomOption(ctx: Ctx, courseId: string): Promise<ClassroomOption> {
  return (await classroomOptions(ctx, [courseId]))[courseId] ?? { state: 'hidden' }
}

/**
 * The new-course form: the first online class can use a classroom made on save only when Google already allows it
 * (`offer`); otherwise, with the switch on, the form says the classroom can be added after saving (`later`).
 */
export async function newCourseClassroom(ctx: Ctx): Promise<{ offer: boolean; later: boolean }> {
  if (!canUseClassroom(ctx.user)) return { offer: false, later: false }
  const granted = (await googleMeetAccess(ctx.db, ctx.user.id))?.granted ?? false
  return { offer: granted, later: !granted }
}

/**
 * Creates a Meet space with the signed-in lecturer's Google account. `needsGoogle` means the lecturer has no
 * Google account, has not granted the Meet permission, or Google refused the token (revoked or stale scopes):
 * they must connect Google again. Any other failure is rethrown.
 */
export async function makeMeetSpaceForUser(
  ctx: Ctx,
): Promise<{ space: MeetSpace; accountId: string } | { needsGoogle: true }> {
  const access = await googleMeetAccess(ctx.db, ctx.user.id)
  if (!access || !access.granted) return { needsGoogle: true }
  try {
    const token = await googleMeetAccessToken(ctx.user.id, access.accountId)
    const space = await (makerForTests ?? createMeetSpace)(token)
    return { space, accountId: access.accountId }
  } catch (error) {
    if (error instanceof MeetPermissionError) return { needsGoogle: true }
    throw error
  }
}

/**
 * Returns the course's classroom, creating it on first use. Only the course owner may do this, and only while the
 * classroom switch allows them; both are checked before Google is touched. Two requests at once end with one row:
 * the loser's space is left unused.
 */
export async function createClassroom(ctx: Ctx, courseId: string): Promise<CreateClassroomResult> {
  await requireCourseOwner(ctx, courseId)
  if (!canUseClassroom(ctx.user)) throw new AppError('FORBIDDEN', 'Classrooms are not available for this account')

  const existing = await getClassroom(ctx.db, courseId)
  if (existing) return { kind: 'ready', classroom: existing }

  const made = await makeMeetSpaceForUser(ctx)
  if ('needsGoogle' in made) return { kind: 'needsGoogle' }

  await ctx.db
    .insert(courseClassroom)
    .values({
      courseId,
      spaceName: made.space.spaceName,
      meetingUrl: made.space.meetingUrl,
      meetingCode: made.space.meetingCode,
      googleAccountId: made.accountId,
      knockingConfirmed: made.space.knockingConfirmed,
      createdBy: ctx.user.id,
    })
    .onConflictDoNothing({ target: courseClassroom.courseId })
  const classroom = await getClassroom(ctx.db, courseId)
  if (!classroom) throw new Error('Classroom row missing after insert')
  return { kind: 'ready', classroom }
}

/** For a schedule slot that uses the course classroom: the switch must allow it and the course must have one. */
export async function assertClassroomUsable(ctx: Ctx, courseId: string): Promise<void> {
  if (!canUseClassroom(ctx.user)) throw new AppError('FORBIDDEN', 'Classrooms are not available for this account')
  if (!(await getClassroom(ctx.db, courseId))) {
    throw new AppError('VALIDATION', 'Create the course classroom first', {
      fields: ['autoMeet'],
      reason: 'no_classroom',
    })
  }
}
