import { beforeEach, describe, expect, it, vi } from 'vitest'

const getSessionUser = vi.hoisted(() => vi.fn())
const redirect = vi.hoisted(() =>
  vi.fn((url: string) => {
    throw new Error(`NEXT_REDIRECT:${url}`)
  }),
)
vi.mock('@/server/auth/session', () => ({ getSessionUser }))
vi.mock('next/navigation', () => ({ redirect }))

import { redirectIfSignedIn } from './redirect-if-signed-in'

describe('redirectIfSignedIn', () => {
  beforeEach(() => {
    getSessionUser.mockReset()
    redirect.mockClear()
  })

  it('sends a signed-in user to the dashboard', async () => {
    getSessionUser.mockResolvedValue({ id: 'u1', role: 'student' })
    await expect(redirectIfSignedIn()).rejects.toThrow('NEXT_REDIRECT:/dashboard')
    expect(redirect).toHaveBeenCalledWith('/dashboard')
  })

  it('lets a visitor through', async () => {
    getSessionUser.mockResolvedValue(null)
    await expect(redirectIfSignedIn()).resolves.toBeUndefined()
    expect(redirect).not.toHaveBeenCalled()
  })
})
