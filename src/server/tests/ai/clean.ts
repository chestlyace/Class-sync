import type { Suggestion } from './suggester'

/** Longest reason kept, in characters. */
export const REASON_MAX = 160

const STEP = 4 // quarters

function oneLine(value: unknown): string {
  if (typeof value !== 'string') return ''
  const flat = value.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim()
  if (flat.length <= REASON_MAX) return flat
  return `${flat.slice(0, REASON_MAX - 1).trimEnd()}…`
}

/**
 * Turns whatever the model returned into safe suggestions: only known keys, the first per key,
 * marks rounded to the nearest 0.25 and dropped when outside 0..maxMark, reasons one line of at
 * most 160 characters and never empty. Anything malformed is dropped, never thrown.
 */
export function cleanSuggestions(raw: unknown, keys: Set<string>, maxMark: number): Suggestion[] {
  if (!Number.isFinite(maxMark) || maxMark < 0) return []
  const list = typeof raw === 'object' && raw !== null ? (raw as { suggestions?: unknown }).suggestions : undefined
  if (!Array.isArray(list)) return []

  const out: Suggestion[] = []
  const seen = new Set<string>()
  for (const item of list) {
    if (typeof item !== 'object' || item === null) continue
    const { key, mark, reason } = item as Record<string, unknown>
    if (typeof key !== 'string' || !keys.has(key) || seen.has(key)) continue
    if (typeof mark !== 'number' || !Number.isFinite(mark)) continue
    const rounded = Math.round(mark * STEP) / STEP + 0 // + 0 turns -0 into 0
    if (rounded < 0 || rounded > maxMark) continue
    const line = oneLine(reason)
    if (!line) continue
    seen.add(key)
    out.push({ key, mark: rounded, reason: line })
  }
  return out
}
