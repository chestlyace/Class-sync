import { and, eq, gte, lt, lte } from 'drizzle-orm'
import { config } from '@/server/core/config'
import type { Db } from '@/server/db'
import { classExtra, classNotice, classSlot } from '@/server/db/schema'
import { addDays, instantAt, isoWeekday, localDateOf } from '@/server/lib/local-time'
import { pushClassMissedQuestion, pushClassSoon } from '@/server/push/course-events'
import { buildSittings, type Sitting } from './occurrences'
import { loadOccurrences, loadSittingByKey, sittingsWithAttendance } from './queries'
import { scheduleQueue, type NoticeKind, type NoticeMessage } from './queue'

/** Students and the lecturer are reminded this long before a sitting starts. */
export const REMINDER_LEAD_MS = 15 * 60_000
/** The lecturer is asked whether a sitting without attendance was missed this long after it ends. */
export const MISSED_CHECK_DELAY_MS = 10 * 60_000

async function enqueueNotice(sitting: Sitting, kind: NoticeKind, expected: Date, deliverAt: Date): Promise<void> {
  try {
    await scheduleQueue().send({ sittingKey: sitting.key, kind, expectedAt: expected.toISOString() }, deliverAt)
  } catch (error) {
    console.error(`[schedule] could not queue the ${kind} for ${sitting.key}`, error)
  }
}

/**
 * Queues a sitting's reminder (REMINDER_LEAD_MS before it starts) and missed-check (MISSED_CHECK_DELAY_MS after it
 * ends), each only while still in the future. Never throws: failures are logged.
 */
export async function enqueueSitting(sitting: Sitting, at: Date): Promise<void> {
  const reminderAt = new Date(sitting.startsAt.getTime() - REMINDER_LEAD_MS)
  if (reminderAt.getTime() > at.getTime()) await enqueueNotice(sitting, 'reminder', sitting.startsAt, reminderAt)
  const missedAt = new Date(sitting.endsAt.getTime() + MISSED_CHECK_DELAY_MS)
  if (missedAt.getTime() > at.getTime()) await enqueueNotice(sitting, 'missed-check', sitting.endsAt, missedAt)
}

async function enqueueSittings(sittings: Sitting[], at: Date): Promise<void> {
  for (const sitting of sittings) {
    try {
      await enqueueSitting(sitting, at)
    } catch (error) {
      console.error(`[schedule] could not queue notices for ${sitting.key}`, error)
    }
  }
}

/**
 * After a timetable change: when `date` is today, rebuilds that course's sittings for the day and queues their
 * notices. Older messages for a sitting that moved are dropped by `handleNotice`. Never throws: the change has
 * already been saved, so failures are logged.
 */
export async function enqueueCourseDay(db: Db, courseId: string, date: string, at: Date): Promise<void> {
  try {
    if (date !== localDateOf(at, config.timeZone)) return
    const sittings = buildSittings(await loadOccurrences(db, [courseId], date, date))
    await enqueueSittings(sittings, at)
  } catch (error) {
    console.error(`[schedule] could not queue class notices for course ${courseId} on ${date}`, error)
  }
}

/** Ids of the courses with a weekly slot or an extra class on a local date. */
async function coursesWithClassesOn(db: Db, date: string): Promise<string[]> {
  const tz = config.timeZone
  const [slots, extras] = await Promise.all([
    db
      .selectDistinct({ courseId: classSlot.courseId })
      .from(classSlot)
      .where(and(eq(classSlot.weekday, isoWeekday(date)), lte(classSlot.startsOn, date), gte(classSlot.endsOn, date))),
    db
      .selectDistinct({ courseId: classExtra.courseId })
      .from(classExtra)
      .where(and(gte(classExtra.startsAt, instantAt(date, 0, tz)), lt(classExtra.startsAt, instantAt(addDays(date, 1), 0, tz)))),
  ])
  return [...new Set([...slots, ...extras].map((r) => r.courseId))]
}

/** The daily run: queues the notices of every sitting today. Never throws: failures are logged. */
export async function enqueueToday(db: Db, at: Date): Promise<{ sittings: number }> {
  try {
    const today = localDateOf(at, config.timeZone)
    const courseIds = await coursesWithClassesOn(db, today)
    const sittings = buildSittings(await loadOccurrences(db, courseIds, today, today))
    await enqueueSittings(sittings, at)
    return { sittings: sittings.length }
  } catch (error) {
    console.error("[schedule] could not queue today's class notices", error)
    return { sittings: 0 }
  }
}

/**
 * The queue consumer. Sends a notice only if its sitting still exists unmarked at the expected time (and, for a
 * missed-check, nobody took attendance), and only once: the classNotice row is claimed first. Throws on a database
 * error so the queue retries; once claimed, push problems are logged, never thrown.
 */
export async function handleNotice(db: Db, message: NoticeMessage): Promise<'sent' | 'skipped'> {
  const sitting = await loadSittingByKey(db, message.sittingKey)
  if (!sitting || sitting.status !== null) return 'skipped'

  const expected = Date.parse(message.expectedAt)
  const actual = message.kind === 'reminder' ? sitting.startsAt : sitting.endsAt
  if (actual.getTime() !== expected) return 'skipped'

  if (message.kind === 'missed-check' && (await sittingsWithAttendance(db, [sitting])).has(sitting.key)) {
    return 'skipped'
  }

  const claimed = await db
    .insert(classNotice)
    .values({ occurrenceKey: sitting.key, kind: message.kind })
    .onConflictDoNothing()
    .returning()
  if (claimed.length === 0) return 'skipped'

  try {
    if (message.kind === 'reminder') await pushClassSoon(db, sitting, sitting.occurrences[0]?.room ?? null)
    else await pushClassMissedQuestion(db, sitting)
  } catch (error) {
    console.error(`[schedule] could not push the ${message.kind} for ${sitting.key}`, error)
  }
  return 'sent'
}
