/** Escape LIKE wildcards (and the escape character itself) so user input matches literally. */
export function escapeLike(s: string): string {
  return s.replace(/[\\%_]/g, '\\$&')
}

/** `%input%` for a case-insensitive "contains" match with ILIKE. */
export function containsPattern(s: string): string {
  return `%${escapeLike(s)}%`
}
