import { and, eq, isNull } from 'drizzle-orm'
import { now } from '@/server/core/clock'
import { config } from '@/server/core/config'
import type { Ctx } from '@/server/core/context'
import { AppError } from '@/server/core/errors'
import { classDateStatus, classExtra, classSlot } from '@/server/db/schema'
import { requireCourseOwner } from '@/server/courses/service'
import { isUniqueViolation } from '@/server/lib/db-errors'
import { instantAt, localDateOf, localMinuteOf } from '@/server/lib/local-time'
import { pushClassCancelled, pushClassMakeUp, pushClassMoved, pushClassReinstated } from '@/server/push/course-events'
import { enqueueCourseDay } from './notices'
import { buildSittings, parseOccurrenceKey, type Occurrence } from './occurrences'
import { loadOccurrences, loadSittingByKey } from './queries'
import { requireCampusLocation } from './timetable'

import { parseMakeUpInput, parseOnlineFields, type MakeUpInput, type ParsedMakeUp } from './slot-input'

export { type MakeUpInput } from './slot-input'

function forbidden(): never {
  throw new AppError('FORBIDDEN', 'Only the lecturer of this course can do this')
}

type ParsedKey = NonNullable<ReturnType<typeof parseOccurrenceKey>>

/** The course a key points at, or null when the key is malformed or its slot or extra is gone. */
async function courseOfKey(ctx: Ctx, parsed: ParsedKey): Promise<string | null> {
  if (parsed.kind === 'slot') {
    const [slot] = await ctx.db
      .select({ courseId: classSlot.courseId })
      .from(classSlot)
      .where(eq(classSlot.id, parsed.slotId))
    return slot?.courseId ?? null
  }
  const [extra] = await ctx.db
    .select({ courseId: classExtra.courseId })
    .from(classExtra)
    .where(eq(classExtra.id, parsed.extraId))
  return extra?.courseId ?? null
}

/** The date a key falls on: a slot key carries it, an extra's is the local date it starts. */
async function dateOfKey(ctx: Ctx, parsed: ParsedKey): Promise<string | null> {
  if (parsed.kind === 'slot') return parsed.date
  const [extra] = await ctx.db
    .select({ startsAt: classExtra.startsAt })
    .from(classExtra)
    .where(eq(classExtra.id, parsed.extraId))
  return extra ? localDateOf(extra.startsAt, config.timeZone) : null
}

/**
 * The occurrence with this key, for its course's lecturer. A malformed key, a missing course or class, somebody
 * else's class and a date the slot does not meet on are all FORBIDDEN, so keys cannot be probed.
 */
async function requireOwnedOccurrence(ctx: Ctx, key: string) {
  const parsed = parseOccurrenceKey(key)
  if (!parsed) forbidden()
  const courseId = await courseOfKey(ctx, parsed)
  if (!courseId) forbidden()
  const owned = await requireCourseOwner(ctx, courseId)
  const date = await dateOfKey(ctx, parsed)
  if (!date) forbidden()
  const occ = (await loadOccurrences(ctx.db, [courseId], date, date)).find((o) => o.key === key)
  if (!occ) forbidden()
  return { occ, owned }
}

/** Side effects after a write has been saved: a failure is logged and never reaches the caller. */
async function afterCommit(what: string, run: () => Promise<void>): Promise<void> {
  try {
    await run()
  } catch (error) {
    console.error(`[schedule] could not finish ${what}`, error)
  }
}

/** Requeues the notices of the course's day (it only acts when that day is today). */
async function requeueDays(ctx: Ctx, courseId: string, dates: string[]): Promise<void> {
  const at = now()
  for (const date of new Set(dates)) await enqueueCourseDay(ctx.db, courseId, date, at)
}

const isFuture = (occ: { startsAt: Date }) => occ.startsAt.getTime() > now().getTime()

function extraValues(
  ctx: Ctx,
  courseId: string,
  data: ParsedMakeUp,
  replaces: { slotId: string | null; date: string } | null,
) {
  return {
    courseId,
    startsAt: instantAt(data.date, data.startMinute, config.timeZone),
    endsAt: instantAt(data.date, data.endMinute, config.timeZone),
    room: data.room,
    requireOnCampus: data.requireOnCampus,
    meetingUrl: data.meetingUrl,
    autoMeet: data.autoMeet,
    replacesSlotId: replaces?.slotId ?? null,
    replacesDate: replaces?.date ?? null,
    createdBy: ctx.user.id,
  }
}

async function loadExtraOccurrence(ctx: Ctx, courseId: string, date: string, extraId: string): Promise<Occurrence> {
  const occ = (await loadOccurrences(ctx.db, [courseId], date, date)).find((o) => o.key === `extra:${extraId}`)
  if (!occ) throw new Error(`The make-up class ${extraId} could not be loaded`)
  return occ
}

/** The key of the sitting an occurrence now belongs to, which is not always the occurrence's own key. */
async function sittingKeyOf(ctx: Ctx, courseId: string, date: string, occurrenceKey: string): Promise<string> {
  const sitting = buildSittings(await loadOccurrences(ctx.db, [courseId], date, date)).find((s) =>
    s.occurrences.some((o) => o.key === occurrenceKey),
  )
  if (!sitting) throw new Error(`The sitting for ${occurrenceKey} could not be loaded`)
  return sitting.key
}

/** The slot an occurrence belongs to; null for an extra. */
const slotIdOf = (occ: Occurrence) => (occ.source.kind === 'slot' ? occ.source.slotId : null)

/**
 * Cancels a future class. With `makeUp`, the cancelled class and its replacement are saved together and the
 * roster hears one "moved" notification instead of a cancellation and a make-up.
 */
export async function cancelClass(ctx: Ctx, occurrenceKey: string, makeUp?: MakeUpInput): Promise<string | null> {
  const { occ, owned } = await requireOwnedOccurrence(ctx, occurrenceKey)
  if (!isFuture(occ))
    throw new AppError('VALIDATION', 'Only a class that has not started can be cancelled', { reason: 'not_future' })
  const alreadySet = () =>
    new AppError('VALIDATION', 'This class is already cancelled or answered', { reason: 'already_set' })
  if (occ.status !== null) throw alreadySet()
  const data = makeUp ? parseMakeUpInput(makeUp) : null
  if (data && instantAt(data.date, data.endMinute, config.timeZone).getTime() <= now().getTime()) {
    throw new AppError('VALIDATION', 'A class can only move to a time that has not ended', { fields: ['date'] })
  }
  if (data) await requireCampusLocation(ctx, owned.schoolId, data)

  const slotId = slotIdOf(occ)
  const extraId = occ.source.kind === 'extra' ? occ.source.extraId : null
  // A double submit can pass the check above twice: the guarded writes below let only the first one through,
  // and the loser's transaction rolls back before it adds a make-up.
  const created = await ctx.db.transaction(async (tx) => {
    if (slotId) {
      try {
        await tx.insert(classDateStatus).values({
          slotId,
          date: occ.date,
          status: 'cancelled',
          setBy: ctx.user.id,
        })
      } catch (error) {
        throw isUniqueViolation(error) ? alreadySet() : error
      }
    } else if (extraId) {
      const updated = await tx
        .update(classExtra)
        .set({ status: 'cancelled' })
        .where(and(eq(classExtra.id, extraId), isNull(classExtra.status)))
        .returning({ id: classExtra.id })
      if (updated.length === 0) throw alreadySet()
    }
    if (!data) return null
    const [row] = await tx
      .insert(classExtra)
      .values(extraValues(ctx, occ.courseId, data, { slotId, date: occ.date }))
      .returning({ id: classExtra.id })
    return row
  })

  // Queuing and pushing are kept apart, so a failing push never leaves today's classes unqueued.
  await afterCommit('queuing the changed classes', () =>
    requeueDays(ctx, occ.courseId, data ? [occ.date, data.date] : [occ.date]),
  )
  await afterCommit('telling students about the cancellation', async () => {
    if (data && created) {
      const to = await loadExtraOccurrence(ctx, occ.courseId, data.date, created.id)
      await pushClassMoved(ctx.db, occ, to)
    } else {
      await pushClassCancelled(ctx.db, occ)
    }
  })
  return created?.id ?? null
}

/**
 * Moves one future class online by reusing the cancel-with-make-up flow: the old date is cancelled and
 * replaced by an extra at the same time, with either a pasted link or a generated one. Returns the replacement's
 * occurrence key so the caller can leave the cancelled class page. A string input keeps the paste-only form working.
 */
export async function moveClassOnline(
  ctx: Ctx,
  occurrenceKey: string,
  online: string | { meetingUrl?: string | null; autoMeet?: boolean },
): Promise<string> {
  const mode =
    typeof online === 'string'
      ? { meetingUrl: online, autoMeet: false, requireOnCampus: false }
      : { ...online, requireOnCampus: false }
  const { meetingUrl, autoMeet } = parseOnlineFields(mode)
  if (meetingUrl === null && !autoMeet) {
    throw new AppError('VALIDATION', 'A Google Meet link is required', { fields: ['meetingUrl'] })
  }
  const { occ } = await requireOwnedOccurrence(ctx, occurrenceKey)
  if (occ.online) {
    throw new AppError('VALIDATION', 'This class is already online', { reason: 'already_online' })
  }
  const startMinute = localMinuteOf(occ.startsAt, config.timeZone)
  const endsOnNextDay = localDateOf(occ.endsAt, config.timeZone) > occ.date
  const endMinute = endsOnNextDay ? 1440 : localMinuteOf(occ.endsAt, config.timeZone)
  const extraId = await cancelClass(ctx, occurrenceKey, {
    date: occ.date,
    startMinute,
    endMinute,
    room: occ.room,
    requireOnCampus: false,
    meetingUrl,
    autoMeet,
  })
  if (!extraId) throw new Error(`The online replacement for ${occurrenceKey} could not be created`)
  // A back-to-back sitting starts with an earlier class, so the extra's own key may not open the page.
  return sittingKeyOf(ctx, occ.courseId, occ.date, `extra:${extraId}`)
}

/** Brings a cancelled future class back and tells the roster it is back on. */
export async function undoCancel(ctx: Ctx, occurrenceKey: string): Promise<void> {
  const { occ } = await requireOwnedOccurrence(ctx, occurrenceKey)
  if (!isFuture(occ))
    throw new AppError('VALIDATION', 'Only a class that has not started can be restored', { reason: 'not_future' })
  if (occ.status !== 'cancelled')
    throw new AppError('VALIDATION', 'This class is not cancelled', {
      reason: 'not_cancelled',
    })

  if (occ.source.kind === 'slot') {
    await ctx.db
      .delete(classDateStatus)
      .where(and(eq(classDateStatus.slotId, occ.source.slotId), eq(classDateStatus.date, occ.date)))
  } else {
    await ctx.db.update(classExtra).set({ status: null }).where(eq(classExtra.id, occ.source.extraId))
  }

  await afterCommit('queuing the restored class', () => requeueDays(ctx, occ.courseId, [occ.date]))
  await afterCommit('telling students the class is back on', () => pushClassReinstated(ctx.db, occ))
}

/** Adds a one-off class, optionally standing in for a dated occurrence of the same course. */
export async function addMakeUp(
  ctx: Ctx,
  courseId: string,
  input: MakeUpInput & { replaces?: string },
): Promise<Occurrence> {
  const owned = await requireCourseOwner(ctx, courseId)
  const data = parseMakeUpInput(input)
  await requireCampusLocation(ctx, owned.schoolId, data)

  let replaces: { slotId: string | null; date: string } | null = null
  if (data.replaces !== undefined) {
    const notInCourse = () =>
      new AppError('VALIDATION', 'The class to replace must be one of this course', { fields: ['replaces'] })
    const parsed = parseOccurrenceKey(data.replaces)
    if (!parsed || (await courseOfKey(ctx, parsed)) !== courseId) throw notInCourse()
    const date = await dateOfKey(ctx, parsed)
    const target = date
      ? (await loadOccurrences(ctx.db, [courseId], date, date)).find((o) => o.key === data.replaces)
      : null
    if (!target) throw notInCourse()
    replaces = { slotId: slotIdOf(target), date: target.date }
  }

  const [row] = await ctx.db
    .insert(classExtra)
    .values(extraValues(ctx, courseId, data, replaces))
    .returning()
  const occ = await loadExtraOccurrence(ctx, courseId, data.date, row.id)

  // A class that already ended is only recorded: nobody needs telling.
  if (occ.endsAt.getTime() > now().getTime()) {
    await afterCommit('queuing the make-up class', () => requeueDays(ctx, courseId, [occ.date]))
    await afterCommit('telling students about the make-up class', () => pushClassMakeUp(ctx.db, occ))
  }
  return occ
}

/** The lecturer's answer to "was it missed?": sets every class of an ended sitting. Answering again overwrites. */
export async function answerSitting(ctx: Ctx, sittingKey: string, answer: 'missed' | 'taught'): Promise<void> {
  const parsed = parseOccurrenceKey(sittingKey)
  if (!parsed) forbidden()
  const courseId = await courseOfKey(ctx, parsed)
  if (!courseId) forbidden()
  await requireCourseOwner(ctx, courseId)
  if (answer !== 'missed' && answer !== 'taught')
    throw new AppError('VALIDATION', 'Invalid answer', { fields: ['answer'] })

  const sitting = await loadSittingByKey(ctx.db, sittingKey)
  if (!sitting) forbidden()
  if (sitting.endsAt.getTime() > now().getTime()) {
    throw new AppError('VALIDATION', 'The class has not ended yet', {
      reason: 'not_ended',
    })
  }

  await ctx.db.transaction(async (tx) => {
    for (const occ of sitting.occurrences) {
      if (occ.source.kind === 'slot') {
        await tx
          .insert(classDateStatus)
          .values({
            slotId: occ.source.slotId,
            date: occ.date,
            status: answer,
            setBy: ctx.user.id,
          })
          .onConflictDoUpdate({
            target: [classDateStatus.slotId, classDateStatus.date],
            set: { status: answer, setBy: ctx.user.id, setAt: new Date() },
          })
      } else {
        await tx.update(classExtra).set({ status: answer }).where(eq(classExtra.id, occ.source.extraId))
      }
    }
  })
}
