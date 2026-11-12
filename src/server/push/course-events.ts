import { eq } from 'drizzle-orm'
import type { WindowKind } from '@/server/attendance/sessions'
import { localesOf } from '@/server/assignments/queries'
import { courseRosterQuery } from '@/server/courses/roster'
import type { Db } from '@/server/db'
import { course } from '@/server/db/schema'
import { claimCooldown, forceCooldown, NOTES_COOLDOWN_MS, notesCooldownKey } from './cooldown'
import { safePushItems } from './build'
import { pushPayload, type PushKind, type PushVars } from './payload'
import { queuePush, type PushItem } from './send'

/** One push per roster student, in their language. Nothing is sent to a course nobody is on. */
async function toRoster(
  db: Db,
  courseId: string,
  kind: PushKind,
  vars: (courseTitle: string) => PushVars,
): Promise<PushItem[]> {
  const [row] = await db.select({ title: course.title }).from(course).where(eq(course.id, courseId))
  if (!row) return []
  const roster = await courseRosterQuery(db, { courseId })
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
