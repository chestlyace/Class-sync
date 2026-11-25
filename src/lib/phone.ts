/**
 * Turns what a person types into a phone number in E.164 form (`+` and 8 to 15 digits), or null.
 * Client-safe. Spaces, dashes, dots and brackets are ignored; `00…` means `+…`; a bare Cameroonian
 * mobile number (9 digits starting with 6) gets `+237`.
 */
export function toE164(raw: string): string | null {
  const compact = raw.replace(/[\s\-.()[\]]/g, '')
  let candidate: string
  if (compact.startsWith('+')) candidate = compact
  else if (compact.startsWith('00')) candidate = `+${compact.slice(2)}`
  else if (/^6\d{8}$/.test(compact)) candidate = `+237${compact}`
  else candidate = compact
  return /^\+\d{8,15}$/.test(candidate) ? candidate : null
}
