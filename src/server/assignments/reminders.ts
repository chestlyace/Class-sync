import { and, eq, gt, isNull, lte } from 'drizzle-orm'
import { createElement } from 'react'
import { now } from '@/server/core/clock'
import { config } from '@/server/core/config'
import { courseRosterQuery } from '@/server/courses/roster'
import { db as appDb, type Db } from '@/server/db'
import { assignment, assignmentReminder, course, submission } from '@/server/db/schema'
import { sendNotifications, type Notification } from '@/server/email/notify'
import { AssignmentReminderEmail } from '@/server/email/templates/assignment-reminder'
import { emailSubject } from '@/server/email/templates/verify-email'
import { safePushItems } from '@/server/push/build'
import { pushPayload } from '@/server/push/payload'
import { sendPush } from '@/server/push/send'
import { assignmentLinkBuilder, localesOf } from './queries'

export const REMINDER_WINDOW_MS = 24 * 60 * 60 * 1000
const INSERT_CHUNK = 500

/**
 * Emails (and pushes to) every roster student who has not submitted yet for each published assignment
 * (grades not yet released) due within
 * the next 24 hours (`(at, at + 24 h]`), once per student and assignment. The reminder row is
 * inserted (`on conflict do nothing … returning`) BEFORE sending and only the rows that came back
 * are emailed, so overlapping runs cannot double-send; the price is that a failed send is not
 * retried (reminders are best-effort). A run that is hours late still reminds, because the window
 * is relative to `at` and a reminder is only ever sent once.
 */
export async function sendDueReminders(db: Db, at: Date): Promise<{ assignments: number; reminded: number }> {
  const upper = new Date(at.getTime() + REMINDER_WINDOW_MS)
  const due = await db
    .select({
      id: assignment.id,
      courseId: assignment.courseId,
      title: assignment.title,
      dueAt: assignment.dueAt,
      courseTitle: course.title,
    })
    .from(assignment)
    .innerJoin(course, eq(course.id, assignment.courseId))
    .where(
      and(
        eq(assignment.status, 'published'),
        // Released grades close hand-ins (ruling B9): nothing left to remind about.
        isNull(assignment.gradesReleasedAt),
        gt(assignment.dueAt, at),
        lte(assignment.dueAt, upper),
      ),
    )

  if (due.length === 0) return { assignments: 0, reminded: 0 }
  // One builder per run: without BETTER_AUTH_URL it warns once, not per email.
  const link = assignmentLinkBuilder('reminders')
  let reminded = 0
  for (const a of due) {
    const roster = await courseRosterQuery(db, { courseId: a.courseId })
    if (roster.length === 0) continue
    const submitted = await db
      .select({ studentId: submission.studentId })
      .from(submission)
      .where(eq(submission.assignmentId, a.id))
    const hasSubmitted = new Set(submitted.map((s) => s.studentId))
    const candidates = roster.filter((r) => !hasSubmitted.has(r.studentId))

    // Claim first: only the students whose reminder row this run inserted get an email.
    const claimed = new Set<string>()
    for (let i = 0; i < candidates.length; i += INSERT_CHUNK) {
      const rows = await db
        .insert(assignmentReminder)
        .values(candidates.slice(i, i + INSERT_CHUNK).map((c) => ({ assignmentId: a.id, studentId: c.studentId, sentAt: at })))
        .onConflictDoNothing()
        .returning({ studentId: assignmentReminder.studentId })
      for (const r of rows) claimed.add(r.studentId)
    }
    if (claimed.size === 0) continue

    const localeOf = await localesOf(db, [...claimed])

    // Send per assignment, right after its claim, so a killed run loses at most one assignment's emails.
    const notifications: Notification[] = []
    for (const student of candidates) {
      if (!claimed.has(student.studentId)) continue
      const locale = localeOf.get(student.studentId) ?? 'en'
      notifications.push({
        to: student.email,
        locale,
        subject: emailSubject('assignmentReminder', locale, { courseTitle: a.courseTitle, assignmentTitle: a.title }),
        kind: 'assignmentReminder',
        react: createElement(AssignmentReminderEmail, {
          locale,
          studentName: student.name,
          courseTitle: a.courseTitle,
          assignmentTitle: a.title,
          dueAt: a.dueAt,
          url: link(a.id),
          timeZone: config.timeZone,
        }),
      })
    }
    // Never throws: a provider outage must not fail the cron run (the rows are already claimed).
    await sendNotifications(notifications)
    const pushItems = safePushItems('sendDueReminders', () =>
      candidates
        .filter((student) => claimed.has(student.studentId))
        .map((student) => ({
          userId: student.studentId,
          payload: pushPayload('assignmentReminder', localeOf.get(student.studentId) ?? 'en', {
            courseTitle: a.courseTitle,
            assignmentTitle: a.title,
            dueAt: a.dueAt,
            url: '/assignments/' + encodeURIComponent(a.id),
          }),
        })),
    )
    await sendPush(pushItems) // never throws either
    reminded += notifications.length
  }

  return { assignments: due.length, reminded }
}

/** The job at the current time against the app database; the cron route calls this (UI code may not import `db`). */
export function runDueReminders(): Promise<{ assignments: number; reminded: number }> {
  return sendDueReminders(appDb, now())
}
