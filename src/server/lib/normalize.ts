/** Trim, collapse internal whitespace, lowercase. Used for duplicate-detection keys. */
export function normalizeKey(s: string): string {
  return s.trim().replace(/\s+/g, ' ').toLowerCase()
}
