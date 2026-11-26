import { MEET_SCOPES } from '@/lib/google-meet-scopes'
import { parseMeetingUrl } from './meeting-url'

export { MEET_SCOPES }

/** Minimal client for the Google Meet REST API (spaces.create), called with a lecturer's own access token. */
const SPACES_URL = 'https://meet.googleapis.com/v2/spaces'
const TIMEOUT_MS = 10_000

export type MeetSpace = {
  spaceName: string
  meetingUrl: string
  meetingCode: string
  /** True when the space was created RESTRICTED, so students must knock and the host admits them. */
  knockingConfirmed: boolean
}

/** Google refused the token: 401, or 403 for missing scopes or permission. The lecturer must reconnect Google. */
export class MeetPermissionError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'MeetPermissionError'
  }
}

type GoogleError = { status: string | null; reasons: string[] }

async function readError(res: Response): Promise<GoogleError> {
  try {
    const body: unknown = await res.json()
    const error = (body as { error?: { status?: unknown; details?: unknown } } | null)?.error
    const details = Array.isArray(error?.details) ? error.details : []
    const reasons = details
      .map((d) => (d as { reason?: unknown } | null)?.reason)
      .filter((r): r is string => typeof r === 'string')
    return { status: typeof error?.status === 'string' ? error.status : null, reasons }
  } catch {
    return { status: null, reasons: [] }
  }
}

async function post(accessToken: string, body: object, fetchImpl: typeof fetch): Promise<Response> {
  return fetchImpl(SPACES_URL, {
    method: 'POST',
    headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  })
}

function isPermissionFailure(res: Response, err: GoogleError): boolean {
  if (res.status === 401) return true
  if (res.status !== 403) return false
  return err.status === 'PERMISSION_DENIED' || err.reasons.some((r) => /SCOPE|PERMISSION/i.test(r))
}

/**
 * Creates a Meet space. Asks for RESTRICTED access (students knock, the host admits them); if Google refuses that
 * config, retries once with no config and reports `knockingConfirmed: false`.
 */
export async function createMeetSpace(accessToken: string, fetchImpl: typeof fetch = fetch): Promise<MeetSpace> {
  let knockingConfirmed = true
  let res = await post(accessToken, { config: { accessType: 'RESTRICTED' } }, fetchImpl)
  let err: GoogleError | null = res.ok ? null : await readError(res)

  if (err && res.status === 400 && (err.status === 'INVALID_ARGUMENT' || err.status === 'FAILED_PRECONDITION')) {
    knockingConfirmed = false
    res = await post(accessToken, {}, fetchImpl)
    err = res.ok ? null : await readError(res)
  }

  if (err) {
    if (isPermissionFailure(res, err)) {
      throw new MeetPermissionError(`Google Meet refused the request (${res.status})`)
    }
    throw new Error(`Google Meet API error (${res.status})`)
  }

  const data = (await res.json()) as { name?: unknown; meetingUri?: unknown; meetingCode?: unknown }
  if (typeof data.name !== 'string' || typeof data.meetingUri !== 'string' || typeof data.meetingCode !== 'string') {
    throw new Error('Google Meet API returned an incomplete space')
  }
  const meetingUrl = parseMeetingUrl(data.meetingUri)
  if (!meetingUrl) throw new Error('Google Meet API returned an incomplete space')
  return { spaceName: data.name, meetingUrl, meetingCode: data.meetingCode, knockingConfirmed }
}
