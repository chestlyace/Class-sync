import { describe, expect, it } from 'vitest'
import { pickClientToNavigate, pushSupport, urlBase64ToUint8Array } from './push-client'

const full = { hasServiceWorker: true, hasPushManager: true }

describe('pushSupport', () => {
  it('iPhone Safari not installed needs install', () => {
    // Safari on iOS only exposes PushManager to a Home Screen app.
    expect(pushSupport({ hasServiceWorker: true, hasPushManager: false, isIos: true, isStandalone: false })).toBe(
      'needs-install',
    )
    expect(pushSupport({ ...full, isIos: true, isStandalone: false })).toBe('needs-install')
  })

  it('iPhone installed is supported', () => {
    expect(pushSupport({ ...full, isIos: true, isStandalone: true })).toBe('supported')
    expect(pushSupport({ ...full, isIos: false, isStandalone: false })).toBe('supported')
  })

  it('no PushManager is unsupported', () => {
    expect(pushSupport({ hasServiceWorker: true, hasPushManager: false, isIos: false, isStandalone: false })).toBe(
      'unsupported',
    )
    expect(pushSupport({ hasServiceWorker: false, hasPushManager: false, isIos: false, isStandalone: true })).toBe(
      'unsupported',
    )
    // An installed iPhone app without push (iOS before 16.4) can't be helped by installing again.
    expect(pushSupport({ hasServiceWorker: true, hasPushManager: false, isIos: true, isStandalone: true })).toBe(
      'unsupported',
    )
  })
})

describe('pickClientToNavigate', () => {
  const origin = 'https://clasync.online'

  it('pickClientToNavigate skips a running test window', () => {
    const clients = [{ url: `${origin}/t/ABC123` }, { url: `${origin}/dashboard` }]
    expect(pickClientToNavigate(clients, origin)).toBe(1)
    expect(pickClientToNavigate([{ url: `${origin}/t/ABC123` }], origin)).toBe(-1)
    // Only the /t/ path itself: a page that merely starts with "t" is fine.
    expect(pickClientToNavigate([{ url: `${origin}/tests` }], origin)).toBe(0)
  })

  it('pickClientToNavigate ignores other origins', () => {
    const clients = [{ url: 'https://evil.example/dashboard' }, { url: 'http://clasync.online/dashboard' }]
    expect(pickClientToNavigate(clients, origin)).toBe(-1)
    expect(pickClientToNavigate([...clients, { url: `${origin}/check-in` }], origin)).toBe(2)
    expect(pickClientToNavigate([{ url: 'not a url' }], origin)).toBe(-1)
    expect(pickClientToNavigate([], origin)).toBe(-1)
  })
})

describe('urlBase64ToUint8Array', () => {
  it('urlBase64ToUint8Array decodes a VAPID key', () => {
    // A 65-byte uncompressed P-256 point, as `web-push generate-vapid-keys` prints it (base64url, no padding).
    const bytes = new Uint8Array(65).map((_, i) => (i === 0 ? 4 : (i * 37 + 251) % 256))
    const key = Buffer.from(bytes).toString('base64url')
    expect(key).toMatch(/[-_]/) // exercises the url-safe alphabet
    const decoded = urlBase64ToUint8Array(key)
    expect(decoded).toBeInstanceOf(Uint8Array)
    expect(Array.from(decoded)).toEqual(Array.from(bytes))
    expect(Array.from(urlBase64ToUint8Array('AQID'))).toEqual([1, 2, 3])
    expect(Array.from(urlBase64ToUint8Array('AQ'))).toEqual([1])
  })
})
