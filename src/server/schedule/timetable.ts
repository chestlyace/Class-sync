import { and, asc, eq, gt, gte, inArray, lt, lte, notInArray } from 'drizzle-orm'
import { z } from 'zod'
import { now } from '@/server/core/clock'
import { config } from '@/server/core/config'
import type { Ctx } from '@/server/core/context'
import { AppError } from '@/server/core/errors'
import { requireRole } from '@/server/core/guards'
import { class_, classDateStatus, classExtra, classSlot, course, school } from '@/server/db/schema'
import { requireCourseOwner } from '@/server/courses/service'
import { addDays, localDateOf } from '@/server/lib/local-time'
import { pushTimetableChanged } from '@/server/push/course-events'
import { getSchool } from '@/server/schools/service'
import { enqueueCourseDay } from './notices'

export type SlotInput = {
  weekday: number
  startMinute: number
  endMinute: number
  room: string | null
  requireOnCampus: boolean
  startsOn: string
  endsOn: string
}

export type SlotView = SlotInput & { id: string; courseId: string }

export type SlotOverlap = {
  courseId: string
  courseTitle: string
  className: string
  schoolName: string
  weekday: number
  startMinute: number
  endMinute: number
}

type SlotRow = typeof classSlot.$inferSelect

const MAX_TERM_DAYS = 366

const isDate = (value: string) => /^\d{4}-\d{2}-\d{2}$/.test(value) && addDays(value, 0) === value

const daysBetween = (from: string, to: string) => {
  const ms = (d: string) => {
    const [y, m, day] = d.split('-').map(Number)
    return Date.UTC(y, m - 1, day)
  }
  return Math.round((ms(to) - ms(from)) / 86_400_000)
}

const date = z.string().refine(isDate, 'Invalid date')
const minute = z.number().int().min(0).max(1440)

const slotSchema = z
  .object({
    weekday: z.number().int().min(1).max(7),
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
    startsOn: date,
    endsOn: date,
  })
  .superRefine((slot, ctx) => {
    if (slot.startMinute >= slot.endMinute) {
      ctx.addIssue({ code: 'custom', path: ['endMinute'], message: 'A class must end after it starts' })
    }
    if (isDate(slot.startsOn) && isDate(slot.endsOn)) {
      if (slot.endsOn < slot.startsOn) {
        ctx.addIssue({ code: 'custom', path: ['endsOn'], message: 'The term must not end before it starts' })
      } else if (daysBetween(slot.startsOn, slot.endsOn) > MAX_TERM_DAYS) {
        ctx.addIssue({ code: 'custom', path: ['endsOn'], message: 'The term is too long' })
      }
    }
  })

function parseInput(input: unknown): SlotInput {
  const result = slotSchema.safeParse(input)
  if (!result.success) {
    const fields = [...new Set(result.error.issues.map((i) => i.path.join('.')))]
    throw new AppError('VALIDATION', 'Invalid input', { fields })
  }
  return result.data
}

function toView(row: SlotRow): SlotView {
  return {
    id: row.id,
    courseId: row.courseId,
    weekday: row.weekday,
    startMinute: row.startMinute,
    endMinute: row.endMinute,
    room: row.room,
    requireOnCampus: row.requireOnCampus,
    startsOn: row.startsOn,
    endsOn: row.endsOn,
  }
}

const today = () => localDateOf(now(), config.timeZone)

function forbidden(): never {
  throw new AppError('FORBIDDEN', 'Only the lecturer of this course can do this')
}

/** A missing slot and somebody else's slot are both FORBIDDEN, so slot ids cannot be probed. */
async function requireOwnedSlot(ctx: Ctx, slotId: string) {
  requireRole(ctx, 'lecturer')
  const [slot] = await ctx.db.select().from(classSlot).where(eq(classSlot.id, slotId))
  if (!slot) forbidden()
  return { slot, owned: await requireCourseOwner(ctx, slot.courseId) }
}

async function requireCampusLocation(ctx: Ctx, schoolId: string, input: SlotInput) {
  if (!input.requireOnCampus) return
  const sch = await getSchool(ctx, schoolId)
  if (sch.latitude === null || sch.longitude === null) {
    throw new AppError('VALIDATION', 'The school has no campus location', { reason: 'no_campus_location' })
  }
}

/**
 * The lecturer's other slots (any course) at the same weekday, overlapping minutes and overlapping terms.
 * `exclude` holds the slot itself and, after a split, its ended part.
 */
async function findOverlaps(ctx: Ctx, input: SlotInput, exclude: string[]): Promise<SlotOverlap[]> {
  const rows = await ctx.db
    .select({
      courseId: course.id,
      courseTitle: course.title,
      className: class_.name,
      schoolName: school.name,
      weekday: classSlot.weekday,
      startMinute: classSlot.startMinute,
      endMinute: classSlot.endMinute,
    })
    .from(classSlot)
    .innerJoin(course, eq(course.id, classSlot.courseId))
    .innerJoin(class_, eq(class_.id, course.classId))
    .innerJoin(school, eq(school.id, class_.schoolId))
    .where(
      and(
        eq(course.lecturerId, ctx.user.id),
        eq(classSlot.weekday, input.weekday),
        lt(classSlot.startMinute, input.endMinute),
        gt(classSlot.endMinute, input.startMinute),
        lte(classSlot.startsOn, input.endsOn),
        gte(classSlot.endsOn, input.startsOn),
        exclude.length > 0 ? notInArray(classSlot.id, exclude) : undefined,
      ),
    )
    .orderBy(asc(classSlot.startMinute), asc(course.title))
  return rows
}

/** After a write: tell the roster (only when upcoming dates changed) and requeue today's notices. */
async function afterWrite(ctx: Ctx, courseId: string, touchesUpcoming: boolean) {
  const at = now()
  if (touchesUpcoming) await pushTimetableChanged(ctx.db, courseId, at)
  await enqueueCourseDay(ctx.db, courseId, localDateOf(at, config.timeZone), at)
}

export async function listSlots(ctx: Ctx, courseId: string): Promise<SlotView[]> {
  await requireCourseOwner(ctx, courseId)
  const rows = await ctx.db
    .select()
    .from(classSlot)
    .where(and(eq(classSlot.courseId, courseId), gte(classSlot.endsOn, today())))
    .orderBy(asc(classSlot.weekday), asc(classSlot.startMinute), asc(classSlot.startsOn))
  return rows.map(toView)
}

export async function createSlot(
  ctx: Ctx,
  courseId: string,
  input: SlotInput,
): Promise<{ slot: SlotView; overlaps: SlotOverlap[] }> {
  const owned = await requireCourseOwner(ctx, courseId)
  const data = parseInput(input)
  await requireCampusLocation(ctx, owned.schoolId, data)

  const [row] = await ctx.db
    .insert(classSlot)
    .values({ ...data, courseId, createdBy: ctx.user.id })
    .returning()
  const overlaps = await findOverlaps(ctx, data, [row.id])
  await afterWrite(ctx, courseId, data.endsOn >= today())
  return { slot: toView(row), overlaps }
}

export async function updateSlot(
  ctx: Ctx,
  slotId: string,
  input: SlotInput,
): Promise<{ slot: SlotView; overlaps: SlotOverlap[] }> {
  const { slot: old, owned } = await requireOwnedSlot(ctx, slotId)
  const data = parseInput(input)
  await requireCampusLocation(ctx, owned.schoolId, data)

  const todayDate = today()
  const hasPast = old.startsOn < todayDate
  const sameWeekday = data.weekday === old.weekday

  if (!hasPast) {
    // Not started yet: edit in place. Dated statuses survive only on the same weekday and inside the new term.
    const row = await ctx.db.transaction(async (tx) => {
      const [updated] = await tx.update(classSlot).set(data).where(eq(classSlot.id, old.id)).returning()
      const stale = await tx.select().from(classDateStatus).where(eq(classDateStatus.slotId, old.id))
      const drop = stale
        .filter((s) => !sameWeekday || s.date < data.startsOn || s.date > data.endsOn)
        .map((s) => s.date)
      if (drop.length > 0) {
        await tx
          .delete(classDateStatus)
          .where(and(eq(classDateStatus.slotId, old.id), inArray(classDateStatus.date, drop)))
      }
      return updated
    })
    const overlaps = await findOverlaps(ctx, data, [row.id])
    await afterWrite(ctx, row.courseId, true) // not started yet, so every date is upcoming
    return { slot: toView(row), overlaps }
  }

  // The slot has history: end it yesterday and carry on from today in a new slot.
  const newStart = data.startsOn > todayDate ? data.startsOn : todayDate
  if (newStart > data.endsOn) {
    throw new AppError('VALIDATION', 'The term must not end before today', { fields: ['endsOn'] })
  }
  const yesterday = addDays(todayDate, -1)

  const row = await ctx.db.transaction(async (tx) => {
    await tx
      .update(classSlot)
      .set({ endsOn: old.endsOn < yesterday ? old.endsOn : yesterday })
      .where(eq(classSlot.id, old.id))
    const [created] = await tx
      .insert(classSlot)
      .values({ ...data, startsOn: newStart, courseId: old.courseId, createdBy: ctx.user.id })
      .returning()
    if (sameWeekday) {
      const inTerm = and(gte(classDateStatus.date, newStart), lte(classDateStatus.date, data.endsOn))
      await tx
        .update(classDateStatus)
        .set({ slotId: created.id })
        .where(and(eq(classDateStatus.slotId, old.id), inTerm))
      // A make-up class that replaces a moved date follows it.
      await tx
        .update(classExtra)
        .set({ replacesSlotId: created.id })
        .where(
          and(
            eq(classExtra.replacesSlotId, old.id),
            gte(classExtra.replacesDate, newStart),
            lte(classExtra.replacesDate, data.endsOn),
          ),
        )
    }
    await tx
      .delete(classDateStatus)
      .where(and(eq(classDateStatus.slotId, old.id), gte(classDateStatus.date, todayDate)))
    return created
  })
  const overlaps = await findOverlaps(ctx, data, [row.id, old.id])
  await afterWrite(ctx, row.courseId, true)
  return { slot: toView(row), overlaps }
}

export async function removeSlot(ctx: Ctx, slotId: string): Promise<void> {
  const { slot } = await requireOwnedSlot(ctx, slotId)
  const todayDate = today()

  if (slot.endsOn < todayDate) return // already over: nothing left to remove

  if (slot.startsOn < todayDate) {
    // Keep what already happened; stop the slot from today on.
    await ctx.db.transaction(async (tx) => {
      await tx
        .update(classSlot)
        .set({ endsOn: addDays(todayDate, -1) })
        .where(eq(classSlot.id, slot.id))
      await tx
        .delete(classDateStatus)
        .where(and(eq(classDateStatus.slotId, slot.id), gte(classDateStatus.date, todayDate)))
    })
  } else {
    await ctx.db.delete(classSlot).where(eq(classSlot.id, slot.id))
  }
  await afterWrite(ctx, slot.courseId, true)
}
