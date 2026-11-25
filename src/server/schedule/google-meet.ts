import { createHash } from 'node:crypto'
import { google } from 'googleapis'
import { config } from '@/server/core/config'
import { AppError } from '@/server/core/errors'
import { parseMeetingUrl } from './meeting-url'

/**
 * Meet links come from Google Calendar events. The platform's service account owns the calendar and event; the
 * lecturer is invited as the only attendee, with Google email updates off. Students are never added.
 */
export type MeetEventInput = {
  occurrenceKey: string
  courseTitle: string
  lecturerEmail: string | null
  startsAt: Date
  endsAt: Date
}

export type GeneratedMeet = { meetingUrl: string; calendarEventId: string }

type CalendarEventBody = {
  id: string
  summary: string
  description: string
  start: { dateTime: string; timeZone: string }
  end: { dateTime: string; timeZone: string }
  attendees?: { email: string }[]
  conferenceData: {
    createRequest: { requestId: string; conferenceSolutionKey: { type: string } }
  }
}

type CalendarEventData = {
  id?: string | null
  hangoutLink?: string | null
  conferenceData?: { entryPoints?: { entryPointType?: string | null; uri?: string | null }[] }
}

/** Only the Calendar methods used here, so tests can substitute the client without network calls. */
export type CalendarClient = {
  insert(params: {
    calendarId: string
    conferenceDataVersion: number
    sendUpdates: string
    requestBody: CalendarEventBody
  }): Promise<{ data: CalendarEventData }>
  get(params: { calendarId: string; eventId: string }): Promise<{ data: CalendarEventData }>
}

type GoogleConfig = { email: string; privateKey: string; calendarId: string }

let clientForTests: CalendarClient | null = null

export function setGoogleCalendarForTests(client: CalendarClient | null): void {
  clientForTests = client
}

/** Reads the service-account config without ever exposing the private key to callers or the client. */
export function googleMeetConfig(env: Record<string, string | undefined> = process.env): GoogleConfig | null {
  const email = env.GOOGLE_SERVICE_ACCOUNT_EMAIL?.trim()
  const rawKey = env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY?.trim()
  if (!email || !rawKey) return null
  return {
    email,
    // Next.js supports real newlines in .env files; Heroku/AWS often store the key with escaped \n.
    privateKey: rawKey.replace(/\\n/g, '\n'),
    calendarId: env.GOOGLE_CALENDAR_ID?.trim() || 'primary',
  }
}

export function isMeetGenerationConfigured(env: Record<string, string | undefined> = process.env): boolean {
  return googleMeetConfig(env) !== null
}

/** Changing a class's time or owner produces a new event, so a cached link never points at a stale calendar slot. */
function eventIds(input: MeetEventInput): { eventId: string; requestId: string } {
  const seed = [
    input.occurrenceKey,
    input.startsAt.toISOString(),
    input.endsAt.toISOString(),
    input.courseTitle,
    input.lecturerEmail ?? '',
  ].join('|')
  const hash = createHash('sha256').update(seed).digest('hex')
  return { eventId: `clasync-${hash.slice(0, 32)}`, requestId: `clasync-meet-${hash}` }
}

function notConfigured(): never {
  throw new AppError('VALIDATION', 'Google Meet generation is not configured', {
    fields: ['meetingUrl'],
    reason: 'meet_generation_unavailable',
  })
}

function linkOf(data: CalendarEventData, fallbackId: string): GeneratedMeet {
  const video = data.conferenceData?.entryPoints?.find((e) => e.entryPointType === 'video')
  const meetingUrl = parseMeetingUrl(data.hangoutLink ?? video?.uri ?? null)
  if (!meetingUrl) throw new Error('Google did not return a Google Meet link')
  return { meetingUrl, calendarEventId: data.id ?? fallbackId }
}

async function generate(client: CalendarClient, calendarId: string, input: MeetEventInput): Promise<GeneratedMeet> {
  const { eventId, requestId } = eventIds(input)
  const body: CalendarEventBody = {
    id: eventId,
    summary: input.courseTitle,
    description: `Clasync online class · ${input.occurrenceKey}`,
    start: { dateTime: input.startsAt.toISOString(), timeZone: config.timeZone },
    end: { dateTime: input.endsAt.toISOString(), timeZone: config.timeZone },
    conferenceData: {
      createRequest: { requestId, conferenceSolutionKey: { type: 'hangoutsMeet' } },
    },
  }
  if (input.lecturerEmail) body.attendees = [{ email: input.lecturerEmail }]

  try {
    const { data } = await client.insert({
      calendarId,
      conferenceDataVersion: 1,
      // The lecturer is on the event's attendee list, but Google sends no invitation email: Clasync owns notices.
      sendUpdates: 'none',
      requestBody: body,
    })
    return linkOf(data, eventId)
  } catch (error) {
    const status = (error as { code?: number; response?: { status?: number } })?.code ??
      (error as { response?: { status?: number } })?.response?.status
    if (status !== 409) throw error
    // Deterministic id: a retry (or two instances racing) finds the event instead of making a second link.
    const { data } = await client.get({ calendarId, eventId })
    return linkOf(data, eventId)
  }
}

/** Generates one Meet link for this occurrence. Callers cache it so later reads never call Google again. */
export async function createMeetEvent(input: MeetEventInput): Promise<GeneratedMeet> {
  if (clientForTests) return generate(clientForTests, 'primary', input)
  const settings = googleMeetConfig()
  if (!settings) notConfigured()

  const auth = new google.auth.JWT({
    email: settings.email,
    key: settings.privateKey,
    scopes: ['https://www.googleapis.com/auth/calendar.events'],
  })
  const events = google.calendar({ version: 'v3', auth }).events as unknown as CalendarClient
  return generate(events, settings.calendarId, input)
}
