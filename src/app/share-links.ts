import { headers } from 'next/headers'

/**
 * Links lecturers paste into WhatsApp and email: always absolute. The origin is BETTER_AUTH_URL
 * (as in emails), else the host this page was asked for.
 */
export async function linkOrigin(): Promise<string> {
  const configured = (process.env.BETTER_AUTH_URL ?? '').trim().replace(/\/+$/, '')
  if (configured) return configured
  const h = await headers()
  const host = h.get('x-forwarded-host')?.split(',')[0]?.trim() || h.get('host')
  if (!host) return ''
  const proto = h.get('x-forwarded-proto')?.split(',')[0]?.trim() || (/^(localhost|127\.0\.0\.1|\[::1\])(:|$)/.test(host) ? 'http' : 'https')
  return `${proto}://${host}`
}

/** `path` (starting with `/`) on this site, as an absolute URL. */
export async function absoluteLink(path: string): Promise<string> {
  return `${await linkOrigin()}${path}`
}

/** A class join link: opening it shows the class and a one-tap Join (src/app/(app)/join/page.tsx). */
export function joinLinkPath(code: string): string {
  return `/join?${new URLSearchParams({ code })}`
}

/** A test's student link, `/t/<CODE>`. */
export function testLinkPath(code: string): string {
  return `/t/${encodeURIComponent(code)}`
}
