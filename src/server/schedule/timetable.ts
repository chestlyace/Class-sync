import { and, asc, eq, gt, gte, inArray, like, lt, lte, notInArray } from 'drizzle-orm'
import { now } from '@/server/core/clock'
import { config } from '@/server/core/config'
import type { Ctx } from '@/server/core/context'
import { AppError } from '@/server/core/errors'
import { requireRole } from '@/server/core/guards'
import { class_, classDateStatus, classExtra, classSlot, course, onlineClassJoin, school } from '@/server/db/schema'
import { requireCourseOwner } from '@/server/courses/service'
import { addDays, instantAt, isoWeekday, localDateOf } from '@/server/lib/local-time'
import { pushClassModeChanged, pushTimetableChanged } from '@/server/push/course-events'
import { getSchool } from '@/server/schools/service'
import { cachedMeetingKeysForSlot, deleteCachedMeetings } from './meetings'
import { parseOccurrenceKey } from './occurrences'
import {
  assertOnlineRules,
  isDate,
  parseSlotInput,
  type ParsedSlot,
  type SlotInput,
} from './slot-input'
import { enqueueCourseDay } from './notices'

export { assertOnlineRules, isDate, MAX_TERM_DAYS, type SlotInput } from './slot-input'

export type SlotView = ParsedSlot & { id: string; courseId: string }

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

function toView(row: SlotRow): SlotView {
  return {
    id: row.id,
    courseId: row.courseId,
    weekday: row.weekday,
    startMinute: row.startMinute,
    endMinute: row.endMinute,
    room: row.room,
    requireOnCampus: row.requireOnCampus,
    meetingUrl: row.meetingUrl,
    autoMeet: row.autoMeet,
    startsOn: row.startsOn,
    endsOn: row.endsOn,
  }
}

const today = () => localDateOf(now(), config.timeZone)

/** Online/in-person is decided by the mode, not by the pasted URL text. */
const modeOf = (slot: { meetingUrl: string | null; autoMeet?: boolean }) =>
  slot.meetingUrl !== null || slot.autoMeet === true ? 'online' : 'campus'

/** The first occurrence of this slot from today on, for a notification's day and time. */
function firstUpcomingStart(slot: Pick<SlotRow, 'startsOn' | 'endsOn' | 'weekday' | 'startMinute'>, todayDate: string) {
  const first = slot.startsOn > todayDate ? slot.startsOn : todayDate
  const date = addDays(first, (slot.weekday - isoWeekday(first) + 7) % 7)
  return date > slot.endsOn ? null : instantAt(date, slot.startMinute, config.timeZone)
}

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

/** A class that needs students on campus needs a school with a campus location. */
export async function requireCampusLocation(ctx: Ctx, schoolId: string, input: { requireOnCampus: boolean }) {
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

type WriteNotice = {
  /** Dates, time or room changed: the existing generic "timetable changed" push. */
  timetable: boolean
  /** The class went online or back to campus, if it did. */
  mode?: 'online' | 'campus'
  day?: Date | null
  room?: string | null
}

/** After a write: tell the roster what changed and requeue today's notices. */
async function afterWrite(ctx: Ctx, courseId: string, notice: WriteNotice) {
  const at = now()
  if (notice.timetable) await pushTimetableChanged(ctx.db, courseId, at)
  if (notice.mode) {
    await pushClassModeChanged(ctx.db, courseId, notice.mode === 'online', {
      day: notice.day ?? undefined,
      room: notice.room,
    })
  }
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
  const data = parseSlotInput(input)
  assertOnlineRules(data)
  await requireCampusLocation(ctx, owned.schoolId, data)

  const [row] = await ctx.db
    .insert(classSlot)
    .values({ ...data, courseId, createdBy: ctx.user.id })
    .returning()
  const overlaps = await findOverlaps(ctx, data, [row.id])
  await afterWrite(ctx, courseId, { timetable: data.endsOn >= today() })
  return { slot: toView(row), overlaps }
}

export async function updateSlot(
  ctx: Ctx,
  slotId: string,
  input: SlotInput,
): Promise<{ slot: SlotView; overlaps: SlotOverlap[] }> {
  const { slot: old, owned } = await requireOwnedSlot(ctx, slotId)
  const data = parseSlotInput(input)
  assertOnlineRules(data)
  await requireCampusLocation(ctx, owned.schoolId, data)

  const todayDate = today()
  const hasPast = old.startsOn < todayDate
  const sameWeekday = data.weekday === old.weekday
  const scheduleChanged =
    data.weekday !== old.weekday ||
    data.startMinute !== old.startMinute ||
    data.endMinute !== old.endMinute ||
    data.startsOn !== old.startsOn ||
    data.endsOn !== old.endsOn
  // Only the link or the online mode changed: no dates, time, room or campus rule moved with it.
  const modeOnlyEdit =
    (data.meetingUrl !== old.meetingUrl || data.autoMeet !== old.autoMeet) &&
    !scheduleChanged &&
    data.room === old.room &&
    data.requireOnCampus === old.requireOnCampus
  const modeChanged = modeOf(data) !== modeOf(old)

  // Dates, time, weekday, room or campus rule moving on a slot with history creates a new slot from today; changing
  // only how students join does not, so today's joins and a cancelled today keep pointing at the same class.
  if (!hasPast || modeOnlyEdit) {
    // Edit in place. Dated statuses survive only on the same weekday and inside the new term.
    const row = await ctx.db.transaction(async (tx) => {
      const [updated] = await tx.update(classSlot).set(data).where(eq(classSlot.id, old.id)).returning()
      if ((old.autoMeet || data.autoMeet) && (scheduleChanged || data.autoMeet !== old.autoMeet)) {
        const staleKeys = (await cachedMeetingKeysForSlot(tx, old.id)).filter((key) => {
          const parsed = parseOccurrenceKey(key)
          return parsed?.kind === 'slot' && parsed.date >= todayDate
        })
        await deleteCachedMeetings(tx, staleKeys)
      }
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
    const nextStart = firstUpcomingStart(row, todayDate)
    await afterWrite(ctx, row.courseId, {
      // A pure link edit gets the specific online/campus push instead of the generic one.
      timetable: !modeOnlyEdit,
      mode: modeChanged && nextStart ? modeOf(data) : undefined,
      day: nextStart,
      room: data.room,
    })
    return { slot: toView(row), overlaps }
  }

  // The slot has history: end it yesterday and carry on from today in a new slot, so past classes keep their format.
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
    // Future dates move to a new slot key; their cached links must follow the new schedule.
    if (old.autoMeet || data.autoMeet) {
      const movedKeys = (await cachedMeetingKeysForSlot(tx, old.id)).filter((key) => {
        const parsed = parseOccurrenceKey(key)
        return parsed?.kind === 'slot' && parsed.date >= newStart
      })
      await deleteCachedMeetings(tx, movedKeys)
    }
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
      // Joins already recorded today belong to the same class, only its key changes.
      const oldPrefix = `slot:${old.id}:`
      const joins = await tx.select().from(onlineClassJoin).where(like(onlineClassJoin.occurrenceKey, `${oldPrefix}%`))
      for (const join of joins) {
        const date = join.occurrenceKey.slice(oldPrefix.length)
        if (!isDate(date) || date < newStart || date > data.endsOn) continue
        await tx
          .delete(onlineClassJoin)
          .where(
            and(eq(onlineClassJoin.occurrenceKey, join.occurrenceKey), eq(onlineClassJoin.studentId, join.studentId)),
          )
        await tx
          .insert(onlineClassJoin)
          .values({ ...join, occurrenceKey: `slot:${created.id}:${date}` })
      }
    }
    await tx
      .delete(classDateStatus)
      .where(and(eq(classDateStatus.slotId, old.id), gte(classDateStatus.date, todayDate)))
    return created
  })
  const overlaps = await findOverlaps(ctx, { ...data, startsOn: newStart }, [row.id, old.id])
  const nextStart = firstUpcomingStart(row, todayDate)
  await afterWrite(ctx, row.courseId, {
    timetable: !modeOnlyEdit,
    mode: modeChanged && nextStart ? modeOf(data) : undefined,
    day: nextStart,
    room: data.room,
  })
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
      const staleKeys = (await cachedMeetingKeysForSlot(tx, slot.id)).filter((key) => {
        const parsed = parseOccurrenceKey(key)
        return parsed?.kind === 'slot' && parsed.date >= todayDate
      })
      await deleteCachedMeetings(tx, staleKeys)
    })
  } else {
    await ctx.db.transaction(async (tx) => {
      await tx.delete(classSlot).where(eq(classSlot.id, slot.id))
      await deleteCachedMeetings(tx, await cachedMeetingKeysForSlot(tx, slot.id))
    })
  }
  await afterWrite(ctx, slot.courseId, { timetable: true })
}
