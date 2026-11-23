/**
 * Reading the CA settings form, shared by the form (live "adds up to" helper) and its Server
 * Action. The service (`validateSettings`) is the authority on ranges, decimals and the sum.
 */

/** The settings form's number inputs, in the order they are shown. */
export const POINT_FIELDS = ['attendancePoints', 'assignmentPoints', 'participationPoints', 'testPoints'] as const
export type PointField = (typeof POINT_FIELDS)[number]
export const SETTINGS_FIELDS = ['total', ...POINT_FIELDS, 'participationTarget', 'testsBestOf', 'groups'] as const
export type SettingsField = (typeof SETTINGS_FIELDS)[number]

/** "7.25" or the French "7,25"; blank, negative or junk → NaN. */
export function parseDecimalInput(raw: string): number {
  const text = raw.trim().replace(',', '.')
  if (!/^\d+(\.\d+)?$/.test(text)) return Number.NaN
  return Number(text)
}

/** A whole number ("5"); anything else → NaN. */
export function parseWholeInput(raw: string): number {
  const text = raw.trim()
  if (!/^\d+$/.test(text)) return Number.NaN
  return Number(text)
}

/** "Count the best [ ] tests": blank → every test (null); a whole number; anything else → NaN. */
export function parseBestOfInput(raw: string): number | null {
  if (raw.trim() === '') return null
  return parseWholeInput(raw)
}

/** Sum in whole cents, so 0.1 + 0.2 is exactly 0.3. Unreadable values count as 0. */
export function sumInCents(values: number[]): number {
  return values.reduce((sum, v) => sum + (Number.isFinite(v) ? Math.round(v * 100) : 0), 0)
}

/** A named CA as the form keeps it: numbers as typed. `id` is null until it is saved. */
export type GroupDraft = { key: string; id: string | null; name: string; points: string; bestOf: string }

/**
 * The form's `groups` field (JSON of `GroupDraft`s) as the service's named CAs. A number that
 * can't be read becomes NaN, which the service refuses (range); null when the field isn't
 * shaped right. Blank or missing: no named CAs.
 */
export function parseGroupsInput(raw: string): { id: string | null; name: string; points: number; bestOf: number | null }[] | null {
  if (raw.trim() === '') return []
  let value: unknown
  try {
    value = JSON.parse(raw)
  } catch {
    return null
  }
  if (!Array.isArray(value)) return null
  const groups = []
  for (const g of value) {
    if (typeof g !== 'object' || g === null) return null
    const { id, name, points, bestOf } = g as Record<string, unknown>
    if ((id !== null && typeof id !== 'string') || typeof name !== 'string') return null
    if (typeof points !== 'string' || typeof bestOf !== 'string') return null
    groups.push({ id: id as string | null, name, points: parseDecimalInput(points), bestOf: parseBestOfInput(bestOf) })
  }
  return groups
}
