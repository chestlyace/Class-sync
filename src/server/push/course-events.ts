import { and, eq, inArray } from 'drizzle-orm'
import type { WindowKind } from '@/server/attendance/sessions'
import { localesOf } from '@/server/assignments/queries'
import { courseRosterQuery } from '@/server/courses/roster'
import type { Db } from '@/server/db'
import { course, notificationPreference } from '@/server/db/schema'
import type { Occurrence, Sitting } from '@/server/schedule/occurrences'
import { claimCooldown, forceCooldown, NOTES_COOLDOWN_MS, notesCooldownKey } from './cooldown'
import { safePushItems } from './build'
import { pushPayload, type PushKind, type PushVars } from './payload'
import { queuePush, type PushItem } from './send'

const TIMETABLE_COOLDOWN_MS = 10 * 60_000
const timetableCooldownKey = (courseId: string) => `timetable:${courseId}`

/** One push per roster student, in their language. Nothing is sent to a course nobody is on. */
async function toRoster(
  db: Db,
  courseId: string,
  kind: PushKind,
  vars: (courseTitle: string) => PushVars,
  /** Of these student ids, the ones to leave out (e.g. who switched this kind off). */
  skip?: (studentIds: string[]) => Promise<Set<string>>,
): Promise<PushItem[]> {
  const [row] = await db.select({ title: course.title }).from(course).where(eq(course.id, courseId))
  if (!row) return []
  let roster = await courseRosterQuery(db, { courseId })
  if (skip && roster.length > 0) {
    const skipped = await skip(roster.map((r) => r.studentId))
    roster = roster.filter((r) => !skipped.has(r.studentId))
  }
  if (roster.length === 0) return []
  const locales = await localesOf(
    db,
    roster.map((r) => r.studentId),
  )
  return safePushItems(kind, () =>
    roster.map((r) => ({
      userId: r.studentId,
      payload: pushPayload(kind, locales.get(r.studentId) ?? 'en', vars(row.title)),
    })),
  )
}

/** One push to the course's lecturer, in their language. */
async function toLecturer(
  db: Db,
  courseId: string,
  kind: PushKind,
  vars: (courseTitle: string) => PushVars,
): Promise<PushItem[]> {
  const [row] = await db
    .select({ title: course.title, lecturerId: course.lecturerId })
    .from(course)
    .where(eq(course.id, courseId))
  if (!row) return []
  const locales = await localesOf(db, [row.lecturerId])
  return safePushItems(kind, () => [
    { userId: row.lecturerId, payload: pushPayload(kind, locales.get(row.lecturerId) ?? 'en', vars(row.title)) },
  ])
}

/**
 * A check-in or check-out window opened. Links to plain /check-in, never the signed link. Tagged
 * per window, so a check-out never silently replaces the check-in notification.
 */
export async function pushWindowOpened(
  db: Db,
  courseId: string,
  window: { id: string; kind: WindowKind; closesAt: Date },
): Promise<void> {
  await queuePush('window-opened', () =>
    toRoster(db, courseId, window.kind === 'start' ? 'checkInOpened' : 'checkOutOpened', (courseTitle) => ({
      courseTitle,
      closesAt: window.closesAt,
      url: '/check-in',
      tag: `checkin-${window.id}`,
    })),
  )
}

export async function pushTestStarted(
  db: Db,
  courseId: string,
  test: { id: string; title: string; code: string },
): Promise<void> {
  await queuePush('test-started', () =>
    toRoster(db, courseId, 'testStarted', (courseTitle) => ({
      courseTitle,
      testTitle: test.title,
      url: '/t/' + encodeURIComponent(test.code),
      tag: `test-${test.id}`,
    })),
  )
}

/** One notification per burst of notes: the first item in a window pushes, the rest stay quiet. */
export async function pushNotesAdded(db: Db, courseId: string, itemTitle: string, at: Date): Promise<void> {
  try {
    if (!(await claimCooldown(db, notesCooldownKey(courseId), NOTES_COOLDOWN_MS, at))) return
  } catch (error) {
    console.error('[notes-added] could not claim the notes cooldown', error)
    return
  }
  await queuePush('notes-added', () =>
    toRoster(db, courseId, 'notesAdded', (courseTitle) => ({
      courseTitle,
      itemTitle,
      url: `/courses/${courseId}/notes`,
      tag: `notes-${courseId}`,
    })),
  )
}

/** A topic made visible always pushes, and starts a fresh notes window so its items do not push again. */
export async function pushTopicReleased(db: Db, courseId: string, topicTitle: string, at: Date): Promise<void> {
  try {
    await forceCooldown(db, notesCooldownKey(courseId), NOTES_COOLDOWN_MS, at)
  } catch (error) {
    console.error('[topic-released] could not set the notes cooldown', error)
  }
  await queuePush('topic-released', () =>
    toRoster(db, courseId, 'topicReleased', (courseTitle) => ({
      courseTitle,
      topicTitle,
      url: `/courses/${courseId}/notes`,
      tag: `notes-${courseId}`,
    })),
  )
}

const classTag = (key: string, kind: PushKind) => `class-${key}-${kind}`

/** Students who switched class reminders off (no preference row means on). */
async function remindersOff(db: Db, studentIds: string[]): Promise<Set<string>> {
  const rows = await db
    .select({ userId: notificationPreference.userId })
    .from(notificationPreference)
    .where(and(inArray(notificationPreference.userId, studentIds), eq(notificationPreference.classReminders, false)))
  return new Set(rows.map((r) => r.userId))
}

/**
 * A sitting starts soon. The lecturer always gets a link to open check-in; students on the roster get a
 * reminder unless they turned class reminders off.
 */
export async function pushClassSoon(db: Db, sitting: Sitting, room: string | null): Promise<void> {
  await queuePush('class-soon', async () => {
    const lecturer = await toLecturer(db, sitting.courseId, 'classSoonLecturer', (courseTitle) => ({
      courseTitle,
      startsAt: sitting.startsAt,
      room,
      url: `/schedule/class/${encodeURIComponent(sitting.key)}`,
      tag: classTag(sitting.key, 'classSoonLecturer'),
    }))
    const students = await toRoster(
      db,
      sitting.courseId,
      'classSoon',
      (courseTitle) => ({
        courseTitle,
        startsAt: sitting.startsAt,
        room,
        url: '/dashboard',
        tag: classTag(sitting.key, 'classSoon'),
      }),
      (ids) => remindersOff(db, ids),
    )
    return [...lecturer, ...students]
  })
}

/** A class was cancelled: roster students are told. */
export async function pushClassCancelled(db: Db, occ: Occurrence): Promise<void> {
  await queuePush('class-cancelled', () =>
    toRoster(db, occ.courseId, 'classCancelled', (courseTitle) => ({
      courseTitle,
      day: occ.startsAt,
      startsAt: occ.startsAt,
      url: '/dashboard',
      tag: classTag(occ.key, 'classCancelled'),
    })),
  )
}

/**
 * A cancelled class is back on. It reuses the cancellation's tag, so it replaces that notification on the device.
 */
export async function pushClassReinstated(db: Db, occ: Occurrence): Promise<void> {
  await queuePush('class-reinstated', () =>
    toRoster(db, occ.courseId, 'classReinstated', (courseTitle) => ({
      courseTitle,
      day: occ.startsAt,
      startsAt: occ.startsAt,
      url: '/dashboard',
      tag: classTag(occ.key, 'classCancelled'),
    })),
  )
}

/** A class moved from one time to another. */
export async function pushClassMoved(db: Db, from: Occurrence, to: Occurrence): Promise<void> {
  await queuePush('class-moved', () =>
    toRoster(db, from.courseId, 'classMoved', (courseTitle) => ({
      courseTitle,
      day: from.startsAt,
      newDay: to.startsAt,
      startsAt: to.startsAt,
      url: '/dashboard',
      tag: classTag(from.key, 'classMoved'),
    })),
  )
}

/** An extra class was added. */
export async function pushClassMakeUp(db: Db, occ: Occurrence): Promise<void> {
  await queuePush('class-make-up', () =>
    toRoster(db, occ.courseId, 'classMakeUp', (courseTitle) => ({
      courseTitle,
      newDay: occ.startsAt,
      startsAt: occ.startsAt,
      room: occ.room,
      url: '/dashboard',
      tag: classTag(occ.key, 'classMakeUp'),
    })),
  )
}

/** Nobody took attendance for a sitting: ask the lecturer (only) whether it was missed. */
export async function pushClassMissedQuestion(db: Db, sitting: Sitting): Promise<void> {
  await queuePush('class-missed-question', () =>
    toLecturer(db, sitting.courseId, 'classMissedQuestion', (courseTitle) => ({
      courseTitle,
      day: sitting.startsAt,
      url: '/schedule',
      tag: classTag(sitting.key, 'classMissedQuestion'),
    })),
  )
}

/** One notification per burst of timetable edits to a course. */
export async function pushTimetableChanged(db: Db, courseId: string, at: Date): Promise<void> {
  try {
    if (!(await claimCooldown(db, timetableCooldownKey(courseId), TIMETABLE_COOLDOWN_MS, at))) return
  } catch (error) {
    console.error('[timetable-changed] could not claim the timetable cooldown', error)
    return
  }
  await queuePush('timetable-changed', () =>
    toRoster(db, courseId, 'timetableChanged', (courseTitle) => ({
      courseTitle,
      url: '/dashboard',
      tag: `timetable-${courseId}`,
    })),
  )
}
