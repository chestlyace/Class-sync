import { afterEach, describe, expect, it, vi } from 'vitest'
import { MEET_LINK_PARAMS, MEET_SCOPES } from '@/lib/google-meet-scopes'

vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }),
  usePathname: () => '/courses/c-1/timetable',
  useSearchParams: () => new URLSearchParams(),
}))
vi.mock('@/lib/auth-client', () => ({ authClient: { linkSocial: vi.fn() } }))
vi.mock('../courses/[courseId]/classroom-actions', () => ({ createClassroomAction: vi.fn() }))

import { authClient } from '@/lib/auth-client'
import { createClassroomAction } from '../courses/[courseId]/classroom-actions'
import { pressClassroomButton } from './classroom-button'

const createMock = vi.mocked(createClassroomAction)
const linkMock = vi.mocked(authClient.linkSocial)

function page(query = '') {
  return { pathname: '/schedule', search: new URLSearchParams(query), refresh: vi.fn() }
}

describe('pressClassroomButton', () => {
  afterEach(() => {
    createMock.mockReset()
    linkMock.mockReset()
  })

  it('refreshes the page once the classroom is ready, without going to Google', async () => {
    createMock.mockResolvedValue({ ok: true, data: { kind: 'ready' } })
    const p = page()
    expect(await pressClassroomButton('c-1', p)).toEqual({ kind: 'refreshed' })
    expect(createMock).toHaveBeenCalledWith('c-1')
    expect(p.refresh).toHaveBeenCalledTimes(1)
    expect(linkMock).not.toHaveBeenCalled()
  })

  it('asks Google for the Meet permission and comes back with classroom=google', async () => {
    createMock.mockResolvedValue({ ok: true, data: { kind: 'needsGoogle' } })
    linkMock.mockResolvedValue({ data: null, error: null } as never)
    const p = page('week=2026-11-23&error=access_denied')
    expect(await pressClassroomButton('c-1', p)).toEqual({ kind: 'toGoogle' })
    expect(p.refresh).not.toHaveBeenCalled()
    expect(linkMock).toHaveBeenCalledTimes(1)
    const args = linkMock.mock.calls[0][0] as unknown as {
      provider: string
      scopes: string[]
      additionalParams: Record<string, string>
      callbackURL: string
      errorCallbackURL: string
    }
    expect(args.provider).toBe('google')
    expect(args.scopes).toEqual([...MEET_SCOPES])
    expect(args.additionalParams).toEqual({ ...MEET_LINK_PARAMS })
    // The page's own query is kept; an old error is dropped.
    expect(args.callbackURL).toBe('/schedule?week=2026-11-23&classroom=google')
    expect(args.errorCallbackURL).toBe('/schedule?week=2026-11-23&classroom=google')
  })

  it('just back from Google and still without the permission, explains instead of going round again', async () => {
    createMock.mockResolvedValue({ ok: true, data: { kind: 'needsGoogle' } })
    expect(await pressClassroomButton('c-1', page('classroom=google'))).toEqual({
      kind: 'message',
      key: 'schedule.online.googleStillMissing',
    })
    expect(linkMock).not.toHaveBeenCalled()
  })

  it('goes to Google again when the lecturer presses once more after that message', async () => {
    createMock.mockResolvedValue({ ok: true, data: { kind: 'needsGoogle' } })
    linkMock.mockResolvedValue({ data: null, error: null } as never)
    expect(await pressClassroomButton('c-1', page('classroom=google'), { againToGoogle: true })).toEqual({
      kind: 'toGoogle',
    })
    expect(linkMock).toHaveBeenCalledTimes(1)
  })

  it('a failed round trip (Google sent an error back) goes to Google again on the next press', async () => {
    createMock.mockResolvedValue({ ok: true, data: { kind: 'needsGoogle' } })
    linkMock.mockResolvedValue({ data: null, error: null } as never)
    expect(await pressClassroomButton('c-1', page('classroom=google&error=access_denied'))).toEqual({
      kind: 'toGoogle',
    })
  })

  it('shows the auth error when Google linking is refused, for example an unconfirmed email', async () => {
    createMock.mockResolvedValue({ ok: true, data: { kind: 'needsGoogle' } })
    linkMock.mockResolvedValue({
      data: null,
      error: { code: 'EMAIL_NOT_VERIFIED_FOR_LINK', status: 403 },
    } as never)
    expect(await pressClassroomButton('c-1', page())).toEqual({
      kind: 'message',
      key: 'settings.signInMethods.confirmEmailFirst',
    })
  })

  it('says Google did not create the room when the action throws', async () => {
    createMock.mockRejectedValue(new Error('Meet API 503'))
    expect(await pressClassroomButton('c-1', page())).toEqual({
      kind: 'message',
      key: 'schedule.online.createFailed',
    })
  })

  it('hands back a refused action for the form to show', async () => {
    createMock.mockResolvedValue({ ok: false, code: 'FORBIDDEN' })
    expect(await pressClassroomButton('c-1', page())).toEqual({
      kind: 'failed',
      result: { ok: false, code: 'FORBIDDEN' },
    })
    expect(linkMock).not.toHaveBeenCalled()
  })
})
