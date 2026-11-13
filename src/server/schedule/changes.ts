import { and, eq } from 'drizzle-orm'
import { z } from 'zod'
import { now } from '@/server/core/clock'
import { config } from '@/server/core/config'
import type { Ctx } from '@/server/core/context'
import { AppError } from '@/server/core/errors'
import { classDateStatus, classExtra, classSlot } from '@/server/db/schema'
import { requireCourseOwner } from '@/server/courses/service'
import { addDays, instantAt, localDateOf } from '@/server/lib/local-time'
import { pushClassCancelled, pushClassMakeUp, pushClassMoved } from '@/server/push/course-events'
import { enqueueCourseDay } from './notices'
import { parseOccurrenceKey, type Occurrence } from './occurrences'
import { loadOccurrences, loadSittingByKey } from './queries'
import { requireCampusLocation } from './timetable'

export type MakeUpInput = {
  date: string
  startMinute: number
  endMinute: number
  room: string | null
  requireOnCampus: boolean
}

const isDate = (value: string) => /^\d{4}-\d{2}-\d{2}$/.test(value) && addDays(value, 0) === value
const minute = z.number().int().min(0).max(1440)

const makeUpSchema = z
  .object({
    date: z.string().refine(isDate, 'Invalid date'),
    startMinute: minute,
    endMinute: minute,
    // Empty means "no room".
    room: z
      .string()
      .trim()
      .max(60)
      .nullish()
      .transform((r) => r || null),
    requireOnCampus: z.boolean(),
    replaces: z.string().optional(),
  })
  .superRefine((value, ctx) => {
    if (value.startMinute >= value.endMinute) {
      ctx.addIssue({
        code: 'custom',
        path: ['endMinute'],
        message: 'A class must end after it starts',
      })
    }
  })

type ParsedMakeUp = z.output<typeof makeUpSchema>

function parseMakeUp(input: unknown): ParsedMakeUp {
  const result = makeUpSchema.safeParse(input)
  if (!result.success) {
    const fields = [...new Set(result.error.issues.map((i) => i.path.join('.')))]
    throw new AppError('VALIDATION', 'Invalid input', { fields })
  }
  return result.data
}

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

/** The slot an occurrence belongs to; null for an extra. */
const slotIdOf = (occ: Occurrence) => (occ.source.kind === 'slot' ? occ.source.slotId : null)

/**
 * Cancels a future class. With `makeUp`, the cancelled class and its replacement are saved together and the
 * roster hears one "moved" notification instead of a cancellation and a make-up.
 */
export async function cancelClass(ctx: Ctx, occurrenceKey: string, makeUp?: MakeUpInput): Promise<void> {
  const { occ, owned } = await requireOwnedOccurrence(ctx, occurrenceKey)
  if (!isFuture(occ))
    throw new AppError('VALIDATION', 'Only a class that has not started can be cancelled', { reason: 'not_future' })
  if (occ.status !== null) {
    throw new AppError('VALIDATION', 'This class is already cancelled or answered', { reason: 'already_set' })
  }
  const data = makeUp ? parseMakeUp(makeUp) : null
  if (data && instantAt(data.date, data.endMinute, config.timeZone).getTime() <= now().getTime()) {
    throw new AppError('VALIDATION', 'A class can only move to a time that has not ended', { fields: ['date'] })
  }
  if (data) await requireCampusLocation(ctx, owned.schoolId, data)

  const slotId = slotIdOf(occ)
  const extraId = occ.source.kind === 'extra' ? occ.source.extraId : null
  const created = await ctx.db.transaction(async (tx) => {
    if (slotId) {
      await tx.insert(classDateStatus).values({
        slotId,
        date: occ.date,
        status: 'cancelled',
        setBy: ctx.user.id,
      })
    } else if (extraId) {
      await tx.update(classExtra).set({ status: 'cancelled' }).where(eq(classExtra.id, extraId))
    }
    if (!data) return null
    const [row] = await tx
      .insert(classExtra)
      .values(extraValues(ctx, occ.courseId, data, { slotId, date: occ.date }))
      .returning({ id: classExtra.id })
    return row
  })

  await afterCommit('the cancellation', async () => {
    if (data && created) {
      const to = await loadExtraOccurrence(ctx, occ.courseId, data.date, created.id)
      await pushClassMoved(ctx.db, occ, to)
    } else {
      await pushClassCancelled(ctx.db, occ)
    }
    await requeueDays(ctx, occ.courseId, data ? [occ.date, data.date] : [occ.date])
  })
}

/** Brings a cancelled future class back. Nobody is notified. */
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

  await afterCommit('restoring the class', () => requeueDays(ctx, occ.courseId, [occ.date]))
}

/** Adds a one-off class, optionally standing in for a dated occurrence of the same course. */
export async function addMakeUp(
  ctx: Ctx,
  courseId: string,
  input: MakeUpInput & { replaces?: string },
): Promise<Occurrence> {
  const owned = await requireCourseOwner(ctx, courseId)
  const data = parseMakeUp(input)
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
    await afterCommit('the make-up class', async () => {
      await pushClassMakeUp(ctx.db, occ)
      await requeueDays(ctx, courseId, [occ.date])
    })
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
