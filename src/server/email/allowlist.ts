/**
 * Whether an email may go to `to` in this environment. Vercel production sends to everyone.
 * Elsewhere a non-empty EMAIL_ALLOWLIST (comma-separated, case-insensitive) limits recipients;
 * a Vercel preview without one sends nothing, so staging can never email real users.
 */
export function isAllowedRecipient(
  to: string,
  env: { VERCEL_ENV?: string; EMAIL_ALLOWLIST?: string } = process.env,
): boolean {
  if (env.VERCEL_ENV === 'production') return true
  const list = (env.EMAIL_ALLOWLIST ?? '')
    .split(',')
    .map((a) => a.trim().toLowerCase())
    .filter(Boolean)
  if (list.length > 0) return list.includes(to.trim().toLowerCase())
  return env.VERCEL_ENV !== 'preview'
}
