import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { checkInLinkPath, signCheckInLink, verifyCheckInLink } from './link'

const WINDOW = '3f0c7a52-5d1e-4b8a-9a43-1c2d3e4f5a6b'

describe('check-in links', () => {
  beforeEach(() => vi.stubEnv('BETTER_AUTH_SECRET', 'a'.repeat(64)))
  afterEach(() => vi.unstubAllEnvs())

  it('signs a window id and verifies it back', () => {
    const token = signCheckInLink(WINDOW)
    expect(token).toMatch(new RegExp(`^${WINDOW}\\.[A-Za-z0-9_-]{22}$`))
    expect(verifyCheckInLink(token)).toBe(WINDOW)
    // Deterministic: the same window always gets the same link.
    expect(signCheckInLink(WINDOW)).toBe(token)
  })

  it('a signature is good for its own window only', () => {
    const other = '00000000-0000-4000-8000-000000000000'
    const sig = signCheckInLink(WINDOW).split('.')[1]
    expect(verifyCheckInLink(`${other}.${sig}`)).toBeNull()
  })

  it('rejects tampered, truncated and malformed tokens', () => {
    const token = signCheckInLink(WINDOW)
    const sig = token.split('.')[1]
    const flipped = (sig[0] === 'A' ? 'B' : 'A') + sig.slice(1)
    for (const bad of [
      `${WINDOW}.${flipped}`,
      `${WINDOW}.${sig.slice(0, -1)}`,
      `${WINDOW}.${sig}x`,
      WINDOW,
      `.${sig}`,
      `${WINDOW}.`,
      `${WINDOW} .${sig}`,
      `${'a'.repeat(65)}.${sig}`,
      '',
      undefined,
      42,
      null,
    ]) {
      expect(verifyCheckInLink(bad)).toBeNull()
    }
  })

  it('a link signed under another secret is refused (rotating the secret revokes links)', () => {
    const token = signCheckInLink(WINDOW)
    vi.stubEnv('BETTER_AUTH_SECRET', 'b'.repeat(64))
    expect(verifyCheckInLink(token)).toBeNull()
    expect(verifyCheckInLink(signCheckInLink(WINDOW))).toBe(WINDOW)
  })

  it('refuses to sign without a secret rather than signing with an empty key', () => {
    vi.stubEnv('BETTER_AUTH_SECRET', '')
    expect(() => signCheckInLink(WINDOW)).toThrow(/BETTER_AUTH_SECRET/)
  })

  it('builds the /check-in path, never the rotating code', () => {
    const token = signCheckInLink(WINDOW)
    const path = checkInLinkPath(token)
    expect(path).toBe(`/check-in?w=${encodeURIComponent(token)}`)
    expect(new URL(path, 'https://clasync.test').searchParams.get('w')).toBe(token)
  })
})
