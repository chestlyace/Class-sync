/**
 * Duplicate-detection and search key: Unicode-normalised, lowercased, accents folded, whitespace
 * trimmed and collapsed. "Université  de Buéa" and "universite de buea" share one key.
 */
export function normalizeKey(s: string): string {
  return s
    .normalize('NFC')
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{M}+/gu, '') // combining marks, i.e. the accents split off by NFD
    .normalize('NFC')
    .trim()
    .replace(/\s+/g, ' ')
}
