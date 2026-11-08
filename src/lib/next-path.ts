// Room for an assistant's OAuth authorization request (src/lib/oauth-resume.ts).
const MAX_NEXT_LENGTH = 2048

/**
 * The `next` parameter of the sign-in page, when it is safe to send the user there: a path on this
 * site (starts with one `/`, no `//` or `\` that browsers read as another host, even encoded, no
 * control characters). Anything else is null and the caller uses its default.
 */
export function safeNextPath(value: unknown): string | null {
  if (typeof value !== 'string' || value.length === 0 || value.length > MAX_NEXT_LENGTH) return null
  if (!value.startsWith('/') || value.startsWith('//')) return null
  if (value.includes('\\')) return null
  // A slash or backslash encoded right after the first `/` reads as `//` once decoded again.
  if (/^\/%(2f|5c)/i.test(value)) return null
  if (/[\u0000-\u001f\u007f]/.test(value)) return null
  return value
}
