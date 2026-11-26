import { describe, expect, it } from 'vitest'
import { AppError } from '@/server/core/errors'
import { MEET_SCOPES as scopesFromLib } from '@/lib/google-meet-scopes'
import { MEET_SCOPES, MeetPermissionError, createMeetSpace } from './meet-api'

const SPACES_URL = 'https://meet.googleapis.com/v2/spaces'
const space = { name: 'spaces/abc', meetingUri: 'https://meet.google.com/abc-defg-hij', meetingCode: 'abc-defg-hij' }

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
}

type Call = { url: string; init: RequestInit }

function fake(...responses: Response[]) {
  const calls: Call[] = []
  const fetchImpl = (async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), init: init ?? {} })
    const next = responses.shift()
    if (!next) throw new Error('unexpected extra request')
    return next
  }) as typeof fetch
  return { fetchImpl, calls }
}

describe('createMeetSpace', () => {
  it('creates a restricted space', async () => {
    const { fetchImpl, calls } = fake(json(200, space))
    const result = await createMeetSpace('tok', fetchImpl)
    expect(result).toEqual({
      spaceName: 'spaces/abc',
      meetingUrl: 'https://meet.google.com/abc-defg-hij',
      meetingCode: 'abc-defg-hij',
      knockingConfirmed: true,
    })
    expect(calls).toHaveLength(1)
    expect(calls[0].url).toBe(SPACES_URL)
    expect(calls[0].init.method).toBe('POST')
    expect((calls[0].init.headers as Record<string, string>).Authorization).toBe('Bearer tok')
    expect(calls[0].init.body).toBe('{"config":{"accessType":"RESTRICTED"}}')
  })

  it('falls back without config when RESTRICTED is refused', async () => {
    const { fetchImpl, calls } = fake(json(400, { error: { status: 'INVALID_ARGUMENT' } }), json(200, space))
    const result = await createMeetSpace('tok', fetchImpl)
    expect(result.knockingConfirmed).toBe(false)
    expect(result.meetingUrl).toBe('https://meet.google.com/abc-defg-hij')
    expect(calls).toHaveLength(2)
    expect(calls[1].init.body).toBe('{}')
  })

  it('does not retry other failures', async () => {
    const { fetchImpl, calls } = fake(json(400, { error: { status: 'OUT_OF_RANGE' } }))
    await expect(createMeetSpace('tok', fetchImpl)).rejects.toThrow('400')
    expect(calls).toHaveLength(1)
  })

  it('throws MeetPermissionError on 401', async () => {
    const { fetchImpl } = fake(json(401, { error: { status: 'UNAUTHENTICATED' } }))
    await expect(createMeetSpace('tok', fetchImpl)).rejects.toBeInstanceOf(MeetPermissionError)
  })

  it('throws MeetPermissionError on 403 PERMISSION_DENIED', async () => {
    const { fetchImpl } = fake(json(403, { error: { status: 'PERMISSION_DENIED' } }))
    await expect(createMeetSpace('tok', fetchImpl)).rejects.toBeInstanceOf(MeetPermissionError)
  })

  it('throws a plain Error, not MeetPermissionError, when the Meet API is not enabled', async () => {
    const { fetchImpl } = fake(
      json(403, { error: { status: 'PERMISSION_DENIED', details: [{ reason: 'SERVICE_DISABLED' }] } }),
    )
    const error = await createMeetSpace('secret-token', fetchImpl).catch((e: unknown) => e)
    expect(error).toBeInstanceOf(Error)
    expect(error).not.toBeInstanceOf(MeetPermissionError)
    expect((error as Error).message).toContain('403')
    expect((error as Error).message).toContain('SERVICE_DISABLED')
    expect((error as Error).message).not.toContain('secret-token')
  })

  it('throws a plain Error on 500 without leaking the token', async () => {
    const { fetchImpl } = fake(json(500, { error: { status: 'INTERNAL' } }))
    const error = await createMeetSpace('secret-token', fetchImpl).catch((e: unknown) => e)
    expect(error).toBeInstanceOf(Error)
    expect(error).not.toBeInstanceOf(MeetPermissionError)
    expect((error as Error).message).toContain('500')
    expect((error as Error).message).not.toContain('secret-token')
  })

  it('rejects a non-Meet meetingUri', async () => {
    const { fetchImpl } = fake(json(200, { ...space, meetingUri: 'https://evil.example/x' }))
    const error = await createMeetSpace('tok', fetchImpl).catch((e: unknown) => e)
    expect(error).toBeInstanceOf(Error)
    expect(error).not.toBeInstanceOf(AppError)
    expect((error as Error).message).toBe('Google returned a non-Meet address')
  })

  it('rejects a response with missing fields', async () => {
    const { fetchImpl } = fake(json(200, { name: 'spaces/abc' }))
    await expect(createMeetSpace('tok', fetchImpl)).rejects.toThrow('incomplete')
  })
})

describe('MEET_SCOPES', () => {
  it('is the shared scope list', () => {
    expect(MEET_SCOPES).toBe(scopesFromLib)
    expect([...MEET_SCOPES]).toEqual([
      'https://www.googleapis.com/auth/meetings.space.created',
      'https://www.googleapis.com/auth/meetings.space.settings',
    ])
  })
})
