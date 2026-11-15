import type { classDateStatus, classExtra, classSlot, ClassStatus } from '@/server/db/schema/schedule'
import { addDays, instantAt, isoWeekday, localDateOf } from '@/server/lib/local-time'

export type SlotRow = typeof classSlot.$inferSelect
export type StatusRow = typeof classDateStatus.$inferSelect
export type ExtraRow = typeof classExtra.$inferSelect

export type Occurrence = {
  /** 'slot:<slotId>:<date>' | 'extra:<id>' */
  key: string
  courseId: string
  /** Local date, "YYYY-MM-DD". */
  date: string
  startsAt: Date
  endsAt: Date
  room: string | null
  requireOnCampus: boolean
  status: ClassStatus | null
  source:
    | { kind: 'slot'; slotId: string }
    | { kind: 'extra'; extraId: string; replaces: { slotId: string | null; date: string } | null }
}

/** One continuous stretch of teaching for a course on a day: back-to-back classes merged. */
export type Sitting = {
  key: string
  courseId: string
  date: string
  startsAt: Date
  endsAt: Date
  occurrences: Occurrence[]
  status: 'missed' | 'taught' | null
}

/** Classes of one course on one day closer than this (or overlapping) form one sitting. */
export const SITTING_GAP_MS = 30 * 60_000

/**
 * Every class between two local dates (inclusive), from weekly slots (with their per-date statuses) and one-off
 * extras. Cancelled classes are kept, flagged with their status. Sorted by start time.
 */
export function expandOccurrences(input: {
  slots: SlotRow[]
  statuses: StatusRow[]
  extras: ExtraRow[]
  from: string
  to: string
  timeZone: string
}): Occurrence[] {
  const { slots, statuses, extras, from, to, timeZone } = input
  if (from > to) return []

  const statusByKey = new Map<string, ClassStatus>()
  for (const s of statuses) statusByKey.set(`${s.slotId}:${s.date}`, s.status)

  const out: Occurrence[] = []

  for (const slot of slots) {
    const first = from > slot.startsOn ? from : slot.startsOn
    const last = to < slot.endsOn ? to : slot.endsOn
    if (first > last) continue
    let date = addDays(first, (slot.weekday - isoWeekday(first) + 7) % 7)
    for (; date <= last; date = addDays(date, 7)) {
      out.push({
        key: `slot:${slot.id}:${date}`,
        courseId: slot.courseId,
        date,
        startsAt: instantAt(date, slot.startMinute, timeZone),
        endsAt: instantAt(date, slot.endMinute, timeZone),
        room: slot.room,
        requireOnCampus: slot.requireOnCampus,
        status: statusByKey.get(`${slot.id}:${date}`) ?? null,
        source: { kind: 'slot', slotId: slot.id },
      })
    }
  }

  for (const extra of extras) {
    const date = localDateOf(extra.startsAt, timeZone)
    if (date < from || date > to) continue
    out.push({
      key: `extra:${extra.id}`,
      courseId: extra.courseId,
      date,
      startsAt: extra.startsAt,
      endsAt: extra.endsAt,
      room: extra.room,
      requireOnCampus: extra.requireOnCampus,
      status: extra.status,
      source: {
        kind: 'extra',
        extraId: extra.id,
        replaces: extra.replacesDate ? { slotId: extra.replacesSlotId, date: extra.replacesDate } : null,
      },
    })
  }

  return out.sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime() || a.key.localeCompare(b.key))
}

/**
 * Merges the non-cancelled classes of each course and date into sittings. A class joins the current sitting when it
 * starts within SITTING_GAP_MS of the sitting's end (overlaps join too). Sorted by start time.
 */
export function buildSittings(occurrences: Occurrence[]): Sitting[] {
  const groups = new Map<string, Occurrence[]>()
  for (const o of occurrences) {
    if (o.status === 'cancelled') continue
    const id = `${o.courseId}|${o.date}`
    const g = groups.get(id)
    if (g) g.push(o)
    else groups.set(id, [o])
  }

  const sittings: Sitting[] = []
  for (const group of groups.values()) {
    group.sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime() || a.key.localeCompare(b.key))
    let current: Occurrence[] = []
    let currentEnd = 0
    const flush = () => {
      if (current.length === 0) return
      const head = current[0]
      const shared = current.every((o) => o.status === head.status) ? head.status : null
      sittings.push({
        key: head.key,
        courseId: head.courseId,
        date: head.date,
        startsAt: head.startsAt,
        endsAt: new Date(currentEnd),
        occurrences: current,
        status: shared === 'missed' || shared === 'taught' ? shared : null,
      })
    }
    for (const o of group) {
      if (current.length > 0 && o.startsAt.getTime() - currentEnd <= SITTING_GAP_MS) {
        current.push(o)
        currentEnd = Math.max(currentEnd, o.endsAt.getTime())
      } else {
        flush()
        current = [o]
        currentEnd = o.endsAt.getTime()
      }
    }
    flush()
  }

  return sittings.sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime() || a.key.localeCompare(b.key))
}

const SLOT_KEY = /^slot:([^:]+):(\d{4}-\d{2}-\d{2})$/
const EXTRA_KEY = /^extra:([^:]+)$/

/** Inverse of `Occurrence.key`. Returns null for anything that isn't a well-formed key. */
export function parseOccurrenceKey(
  key: string,
): { kind: 'slot'; slotId: string; date: string } | { kind: 'extra'; extraId: string } | null {
  const slot = SLOT_KEY.exec(key)
  if (slot) {
    const [, slotId, date] = slot
    const d = new Date(`${date}T00:00:00Z`)
    if (Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== date) return null
    return { kind: 'slot', slotId, date }
  }
  const extra = EXTRA_KEY.exec(key)
  if (extra) return { kind: 'extra', extraId: extra[1] }
  return null
}
