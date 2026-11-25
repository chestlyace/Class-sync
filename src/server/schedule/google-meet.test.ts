import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  createMeetEvent,
  googleMeetConfig,
  isMeetGenerationConfigured,
  setGoogleCalendarForTests,
  type CalendarClient,
} from './google-meet'

const url = 'https://meet.google.com/abc-defg-hij'
const input = {
  occurrenceKey: 'slot:s1:2026-11-16',
  courseTitle: 'Networks',
  lecturerEmail: 'lecturer@example.com',
  startsAt: new Date('2026-11-16T07:00:00.000Z'),
  endsAt: new Date('2026-11-16T09:00:00.000Z'),
}

function fakeClient(over: {
  hangoutLink?: string | null
  insertError?: { code: number }
  eventId?: string
} = {}) {
  const data = { id: over.eventId ?? 'clasync-event', hangoutLink: over.hangoutLink ?? url }
  const insert = vi.fn(async (_params: Parameters<CalendarClient['insert']>[0]) => {
    void _params
    if (over.insertError) throw over.insertError
    return { data }
  })
  const get = vi.fn(async (_params: Parameters<CalendarClient['get']>[0]) => {
    void _params
    return { data }
  })
  return { client: { insert, get } as CalendarClient, insert, get }
}

afterEach(() => {
  setGoogleCalendarForTests(null)
})

describe('Google Meet generation', () => {
  it('invites the lecturer without asking Google to send an email', async () => {
    const { client, insert } = fakeClient()
    setGoogleCalendarForTests(client)

    const result = await createMeetEvent(input)

    expect(result).toEqual({ meetingUrl: url, calendarEventId: 'clasync-event' })
    expect(insert).toHaveBeenCalledTimes(1)
    const [call] = insert.mock.calls[0]
    expect(call.sendUpdates).toBe('none')
    expect(call.conferenceDataVersion).toBe(1)
    expect(call.requestBody.attendees).toEqual([{ email: input.lecturerEmail }])
    expect(call.requestBody.conferenceData.createRequest.conferenceSolutionKey).toEqual({ type: 'hangoutsMeet' })
    expect(call.requestBody.start).toEqual({ dateTime: input.startsAt.toISOString(), timeZone: expect.any(String) })
  })

  it('uses a deterministic event id so a retry finds the same event', async () => {
    const { client, insert } = fakeClient()
    setGoogleCalendarForTests(client)

    await createMeetEvent(input)
    await createMeetEvent(input)

    const [first, second] = insert.mock.calls.map(([call]) => call.requestBody)
    expect(first.id).toBe(second.id)
    expect(first.id).toMatch(/^clasync-[0-9a-f]{32}$/)
    expect(first.conferenceData.createRequest.requestId).toBe(second.conferenceData.createRequest.requestId)

    await createMeetEvent({ ...input, endsAt: new Date(input.endsAt.getTime() + 60_000) })
    const changed = insert.mock.calls[2][0].requestBody
    expect(changed.id).not.toBe(first.id)
  })

  it('falls back to the existing event on a conflict', async () => {
    const { client, insert, get } = fakeClient({ insertError: { code: 409 }, eventId: 'existing-event' })
    setGoogleCalendarForTests(client)

    await expect(createMeetEvent(input)).resolves.toEqual({ meetingUrl: url, calendarEventId: 'existing-event' })
    expect(get).toHaveBeenCalledWith(expect.objectContaining({ eventId: insert.mock.calls[0][0].requestBody.id }))
  })

  it('reads escaped private keys without exposing them', () => {
    const env = {
      GOOGLE_SERVICE_ACCOUNT_EMAIL: ' meet-bot@example.iam.gserviceaccount.com ',
      GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY: '-----BEGIN PRIVATE KEY-----\\nsecret\\n-----END PRIVATE KEY-----\\n',
      GOOGLE_CALENDAR_ID: ' ',
    }
    expect(isMeetGenerationConfigured(env)).toBe(true)
    expect(googleMeetConfig(env)).toEqual({
      email: 'meet-bot@example.iam.gserviceaccount.com',
      privateKey: '-----BEGIN PRIVATE KEY-----\nsecret\n-----END PRIVATE KEY-----\n',
      calendarId: 'primary',
    })
    expect(isMeetGenerationConfigured({})).toBe(false)
  })
})
