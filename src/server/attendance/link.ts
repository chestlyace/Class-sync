import { createHmac, hkdfSync, timingSafeEqual } from 'node:crypto'

/**
 * Check-in links: `/check-in?w=<windowId>.<sig>`, where `sig` is an HMAC of the window id under a
 * key derived from BETTER_AUTH_SECRET. The link never carries the rotating code; it stands in for
 * it, and only for that one window, while that window is open. Nothing is stored: the signature is
 * the proof, so rotating BETTER_AUTH_SECRET invalidates every link (as it does every session).
 */

/** The query parameter that carries the token on /check-in. */
export const CHECK_IN_LINK_PARAM = 'w'

const KEY_INFO = 'clasync/attendance/check-in-link/v1'
/** 128 bits of HMAC-SHA256, base64url: 22 characters keeps the link short enough for a chat message. */
const SIG_BYTES = 16
const MAX_WINDOW_ID_LENGTH = 64
const WINDOW_ID_PATTERN = /^[A-Za-z0-9-]+$/
const SIG_PATTERN = /^[A-Za-z0-9_-]{22}$/

let cachedKey: { secret: string; key: Buffer } | null = null

function linkKey(): Buffer {
  const secret = process.env.BETTER_AUTH_SECRET ?? ''
  if (!secret) throw new Error('BETTER_AUTH_SECRET is not set: check-in links cannot be signed')
  if (cachedKey?.secret !== secret) {
    // A key of its own (HKDF), so a check-in signature is never valid anywhere else the secret is used.
    cachedKey = { secret, key: Buffer.from(hkdfSync('sha256', secret, '', KEY_INFO, 32)) }
  }
  return cachedKey.key
}

function sign(windowId: string): Buffer {
  return createHmac('sha256', linkKey()).update(windowId).digest().subarray(0, SIG_BYTES)
}

/** The token for a window: `<windowId>.<signature>`. */
export function signCheckInLink(windowId: string): string {
  return `${windowId}.${sign(windowId).toString('base64url')}`
}

/** The window a token was signed for, or null when it is malformed or its signature is wrong. */
export function verifyCheckInLink(token: unknown): string | null {
  if (typeof token !== 'string') return null
  const dot = token.lastIndexOf('.')
  if (dot <= 0) return null
  const windowId = token.slice(0, dot)
  const sig = token.slice(dot + 1)
  if (windowId.length > MAX_WINDOW_ID_LENGTH || !WINDOW_ID_PATTERN.test(windowId) || !SIG_PATTERN.test(sig)) return null
  const given = Buffer.from(sig, 'base64url')
  const expected = sign(windowId)
  return given.length === expected.length && timingSafeEqual(given, expected) ? windowId : null
}

/** The site path a student opens: `/check-in?w=<token>`. */
export function checkInLinkPath(token: string): string {
  return `/check-in?${new URLSearchParams({ [CHECK_IN_LINK_PARAM]: token })}`
}
