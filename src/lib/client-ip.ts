type Env = Record<string, string | undefined>

/** Request header with the client's IP, set by src/proxy.ts (any value the client sent is replaced). */
export const CLIENT_IP_HEADER = 'x-clasync-client-ip'

/**
 * The client's IP as the platform's router saw it, from `x-forwarded-for` (else `x-real-ip`):
 * - Vercel replaces any `x-forwarded-for` a client sends, so its first entry is the client;
 * - Heroku's router appends the address it saw to whatever the client sent, so only the last entry can be
 *   trusted there (DYNO is set). The first one is whatever the client wrote.
 * Cut to 64 characters (an IPv6 address is at most 45). Null when there is none.
 */
export function forwardedClientIp(headers: Headers, env: Env = process.env): string | null {
  const hops = (headers.get('x-forwarded-for') ?? '')
    .split(',')
    .map((h) => h.trim())
    .filter(Boolean)
  const ip = hops.length > 0 ? (env.DYNO ? hops[hops.length - 1] : hops[0]) : headers.get('x-real-ip')?.trim()
  return ip ? ip.slice(0, 64) : null
}
