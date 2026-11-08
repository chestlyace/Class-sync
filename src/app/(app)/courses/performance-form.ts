/**
 * Reading the CA settings form, shared by the form (live "adds up to" helper) and its Server
 * Action. The service (`validateSettings`) is the authority on ranges, decimals and the sum.
 */

/** The settings form's number inputs, in the order they are shown. */
export const POINT_FIELDS = ['attendancePoints', 'assignmentPoints', 'participationPoints', 'testPoints'] as const
export type PointField = (typeof POINT_FIELDS)[number]
export const SETTINGS_FIELDS = ['total', ...POINT_FIELDS, 'participationTarget', 'testsBestOf'] as const
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
