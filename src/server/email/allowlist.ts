/**
 * Whether an email may go to `to` in this environment. Vercel production sends to everyone.
 * Elsewhere a non-empty EMAIL_ALLOWLIST (comma-separated, case-insensitive) limits recipients,
 * and `*` in it lets everyone through; a Vercel preview without one sends nothing.
 */
export function isAllowedRecipient(
  to: string,
  env: Record<string, string | undefined> = process.env,
): boolean {
  if (env.VERCEL_ENV === 'production') return true
  const list = (env.EMAIL_ALLOWLIST ?? '')
    .split(',')
    .map((a) => a.trim().toLowerCase())
    .filter(Boolean)
  if (list.includes('*')) return true
  if (list.length > 0) return list.includes(to.trim().toLowerCase())
  return env.VERCEL_ENV !== 'preview'
}
