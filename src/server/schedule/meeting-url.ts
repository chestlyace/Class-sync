import { AppError } from '@/server/core/errors'

/** Lecturers paste Google Meet links; Clasync never generates them (that needs Google Calendar OAuth). */
export const MEETING_HOST = 'meet.google.com'
export const MEETING_URL_MAX = 2048

function invalid(): never {
  throw new AppError('VALIDATION', 'Invalid Google Meet link', {
    fields: ['meetingUrl'],
    reason: 'invalid_meeting_url',
  })
}

/**
 * A normalised Google Meet URL, or null when there is no link. Anything else is a validation error on
 * `meetingUrl`, so every caller of the schedule services gets the same rule, not just the form.
 */
export function parseMeetingUrl(value: string | null | undefined): string | null {
  const trimmed = value?.trim() ?? ''
  if (trimmed === '') return null
  if (trimmed.length > MEETING_URL_MAX) invalid()

  let url: URL
  try {
    url = new URL(trimmed)
  } catch {
    invalid()
  }
  if (
    url.protocol !== 'https:' ||
    url.hostname.toLowerCase() !== MEETING_HOST ||
    url.pathname === '/' ||
    url.username !== '' ||
    url.password !== '' ||
    (url.port !== '' && url.port !== '443')
  ) {
    invalid()
  }
  // URL drops tabs and newlines; keeping the pasted text would break the Location header on Join.
  return url.href
}
