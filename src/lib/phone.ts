/**
 * Turns what a person types into a phone number in E.164 form (`+`, a first digit that is not 0, and 8 to 15
 * digits in all), or null. Client-safe. Spaces, dashes, dots and brackets are ignored; `00…` means `+…`; a
 * bare Cameroonian mobile number (9 digits starting with 6) gets `+237`, and so does one typed with `237`
 * but without the `+`.
 */
export function toE164(raw: string): string | null {
  const compact = raw.replace(/[\s\-.()[\]]/g, '')
  let candidate: string
  if (compact.startsWith('+')) candidate = compact
  else if (compact.startsWith('00')) candidate = `+${compact.slice(2)}`
  else if (/^6\d{8}$/.test(compact)) candidate = `+237${compact}`
  else if (/^2376\d{8}$/.test(compact)) candidate = `+${compact}`
  else candidate = compact
  return /^\+[1-9]\d{7,14}$/.test(candidate) ? candidate : null
}

/**
 * A number for showing on screen without giving it away: the `+`, then bullets, then the last two
 * digits (`+237612345412` becomes `+••••••••••12`). Anything that is not a number gets all bullets.
 */
export function maskPhone(e164: string): string {
  const digits = e164.replace(/\D/g, '')
  if (digits.length <= 2) return `+${'•'.repeat(Math.max(digits.length, 1))}`
  return `+${'•'.repeat(digits.length - 2)}${digits.slice(-2)}`
}
