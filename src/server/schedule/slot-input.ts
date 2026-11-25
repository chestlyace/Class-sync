import { z } from 'zod'
import { AppError } from '@/server/core/errors'
import { addDays } from '@/server/lib/local-time'
import { parseMeetingUrl } from './meeting-url'

export type SlotInput = {
  weekday: number
  startMinute: number
  endMinute: number
  room: string | null
  requireOnCampus: boolean
  /** A pasted Google Meet URL, or null when the class is in person or generates its link. */
  meetingUrl: string | null
  /** Generate one link per dated occurrence on first need. Mutually exclusive with `meetingUrl`. */
  autoMeet?: boolean
  startsOn: string
  endsOn: string
}

export type ParsedSlot = Omit<SlotInput, 'autoMeet'> & { autoMeet: boolean }

export type MakeUpInput = {
  date: string
  startMinute: number
  endMinute: number
  room: string | null
  requireOnCampus: boolean
  meetingUrl: string | null
  autoMeet?: boolean
}

export type ParsedMakeUp = Omit<MakeUpInput, 'autoMeet'> & { autoMeet: boolean }

export const MAX_TERM_DAYS = 366

export const isDate = (value: string) => /^\d{4}-\d{2}-\d{2}$/.test(value) && addDays(value, 0) === value

const date = z.string().refine(isDate, 'Invalid date')
const minute = z.number().int().min(0).max(1440)
const room = z
  .string()
  .trim()
  .max(60)
  .nullish()
  .transform((r) => r || null)

const slotSchema = z
  .object({
    weekday: z.number().int().min(1).max(7),
    startMinute: minute,
    endMinute: minute,
    room,
    requireOnCampus: z.boolean(),
    meetingUrl: z.string().nullish(),
    autoMeet: z.boolean().optional().default(false),
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

const makeUpSchema = z
  .object({
    date,
    startMinute: minute,
    endMinute: minute,
    room,
    requireOnCampus: z.boolean(),
    meetingUrl: z.string().nullish(),
    autoMeet: z.boolean().optional().default(false),
    replaces: z.string().optional(),
  })
  .superRefine((value, ctx) => {
    if (value.startMinute >= value.endMinute) {
      ctx.addIssue({ code: 'custom', path: ['endMinute'], message: 'A class must end after it starts' })
    }
  })

function daysBetween(from: string, to: string): number {
  const ms = (d: string) => {
    const [y, m, day] = d.split('-').map(Number)
    return Date.UTC(y, m - 1, day)
  }
  return Math.round((ms(to) - ms(from)) / 86_400_000)
}

function invalid(issues: { path: readonly PropertyKey[] }[]): never {
  const fields = [...new Set(issues.map((i) => i.path.map(String).join('.')))]
  throw new AppError('VALIDATION', 'Invalid input', { fields })
}

/**
 * The two online modes are exclusive: a slot either carries a pasted Meet URL or asks Google for a fresh one per
 * occurrence. Either way it cannot require students on campus.
 */
export function parseOnlineFields(input: {
  meetingUrl?: string | null
  autoMeet?: boolean
  requireOnCampus: boolean
}): { meetingUrl: string | null; autoMeet: boolean } {
  const meetingUrl = parseMeetingUrl(input.meetingUrl)
  const autoMeet = input.autoMeet === true
  if (meetingUrl !== null && autoMeet) {
    throw new AppError('VALIDATION', 'Choose one way to get a Meet link', {
      fields: ['meetingUrl', 'autoMeet'],
      reason: 'two_meeting_modes',
    })
  }
  assertOnlineRules({ meetingUrl, autoMeet, requireOnCampus: input.requireOnCampus })
  return { meetingUrl, autoMeet }
}

/** An online class can never also require the student's location, in the form or from any other caller. */
export function assertOnlineRules(data: {
  meetingUrl: string | null
  autoMeet?: boolean
  requireOnCampus: boolean
}): void {
  if ((data.meetingUrl !== null || data.autoMeet === true) && data.requireOnCampus) {
    throw new AppError('VALIDATION', 'An online class cannot require students on campus', {
      fields: ['requireOnCampus'],
      reason: 'online_and_campus',
    })
  }
}

export function parseSlotInput(input: unknown): ParsedSlot {
  const result = slotSchema.safeParse(input)
  if (!result.success) invalid(result.error.issues)
  const { meetingUrl, autoMeet } = parseOnlineFields(result.data)
  return { ...result.data, meetingUrl, autoMeet }
}

export function parseMakeUpInput(input: unknown): ParsedMakeUp & { replaces?: string } {
  const result = makeUpSchema.safeParse(input)
  if (!result.success) invalid(result.error.issues)
  const { meetingUrl, autoMeet } = parseOnlineFields(result.data)
  return { ...result.data, meetingUrl, autoMeet }
}
