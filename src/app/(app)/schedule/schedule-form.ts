import { formString } from '@/lib/form-data'
import { AppError } from '@/server/core/errors'
import { addDays, weekStartOf } from '@/server/lib/local-time'
import type { MakeUpInput } from '@/server/schedule/changes'
import type { SlotInput } from '@/server/schedule/timetable'

function invalid(field: string): never {
  throw new AppError('VALIDATION', 'Invalid input', { fields: [field] })
}

const TIME = /^([01]\d|2[0-3]):([0-5]\d)(?::[0-5]\d)?$/

/** An `<input type="time">` value ("08:30") as minutes after midnight. */
export function parseTimeField(data: FormData, key: string): number {
  const match = TIME.exec(formString(data, key))
  if (!match) invalid(key)
  return Number(match[1]) * 60 + Number(match[2])
}

/** An unchecked box is absent from the form; a checked one sends "on". */
export function parseCheckbox(data: FormData, key: string): boolean {
  const value = formString(data, key)
  if (value === '') return false
  if (value === 'on') return true
  invalid(key)
}

function parseWeekday(data: FormData): number {
  const raw = formString(data, 'weekday')
  if (!/^[1-7]$/.test(raw)) invalid('weekday')
  return Number(raw)
}

/** Online fields shared by every class form: one mode only, and a checked Online box needs a way to get a link. */
export function parseOnlineForm(data: FormData): { online: boolean; autoMeet: boolean; meetingUrl: string } {
  const autoMeet = parseCheckbox(data, 'autoMeet')
  const meetingUrl = formString(data, 'meetingUrl')
  // A pasted link is enough on its own (older forms and direct callers); the checkbox only matters when nothing is pasted.
  if (!parseCheckbox(data, 'online') && !autoMeet && meetingUrl === '') {
    return { online: false, autoMeet: false, meetingUrl: '' }
  }
  if (!autoMeet && meetingUrl === '') invalid('meetingUrl')
  return { online: true, autoMeet, meetingUrl }
}

/** The timetable slot form. Dates and the room go through as typed: the service validates them. */
export function parseSlotForm(data: FormData): SlotInput {
  const online = parseOnlineForm(data)
  return {
    weekday: parseWeekday(data),
    startMinute: parseTimeField(data, 'startMinute'),
    endMinute: parseTimeField(data, 'endMinute'),
    room: formString(data, 'room'),
    requireOnCampus: parseCheckbox(data, 'requireOnCampus'),
    meetingUrl: online.meetingUrl,
    ...(online.autoMeet ? { autoMeet: true } : {}),
    startsOn: formString(data, 'startsOn'),
    endsOn: formString(data, 'endsOn'),
  }
}

/** The make-up form; `replaces` (a sitting's key) only when the form carries one. */
export function parseMakeUpForm(data: FormData): MakeUpInput & { replaces?: string } {
  const online = parseOnlineForm(data)
  const input: MakeUpInput & { replaces?: string } = {
    date: formString(data, 'date'),
    startMinute: parseTimeField(data, 'startMinute'),
    endMinute: parseTimeField(data, 'endMinute'),
    room: formString(data, 'room'),
    requireOnCampus: parseCheckbox(data, 'requireOnCampus'),
    meetingUrl: online.meetingUrl,
    ...(online.autoMeet ? { autoMeet: true } : {}),
  }
  const replaces = formString(data, 'replaces')
  if (replaces !== '') input.replaces = replaces
  return input
}

const isDate = (value: string) => /^\d{4}-\d{2}-\d{2}$/.test(value) && addDays(value, 0) === value

/** `?week=YYYY-MM-DD` as the Monday of that week; anything missing or invalid is the week of `today`. */
export function parseWeekParam(raw: string | string[] | undefined, today: string): string {
  return typeof raw === 'string' && isDate(raw) ? weekStartOf(raw) : weekStartOf(today)
}
