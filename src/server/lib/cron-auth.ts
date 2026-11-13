import { timingSafeEqual } from 'node:crypto'

/** Whether the `Authorization` header is `Bearer <secret>`, compared in constant time. */
export function isCronAuthorized(header: string | null, secret: string): boolean {
  const expected = Buffer.from(`Bearer ${secret}`)
  const given = Buffer.from(header ?? '')
  // timingSafeEqual throws on different lengths; a length mismatch is already a rejection.
  return given.length === expected.length && timingSafeEqual(given, expected)
}
