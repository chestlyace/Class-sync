/**
 * A named CA inside the tests part ("CA 1"): its share of the test points and its own "best N".
 * `id` is null for one not saved yet (a new one in the form, or one from a template).
 */
export type CaGroup = { id: string | null; name: string; points: number; bestOf: number | null }

export type CaSettings = {
  total: number
  attendancePoints: number
  assignmentPoints: number
  participationPoints: number
  /** With named CAs, the sum of their points. */
  testPoints: number
  participationTarget: number
  /** Count only the best N tests of each student; null = every test. Unused with named CAs (each has its own). */
  testsBestOf: number | null
  /** The named CAs, in order; none = one tests part. */
  groups: CaGroup[]
}

export const DEFAULT_SETTINGS: CaSettings = {
  total: 30,
  attendancePoints: 5,
  assignmentPoints: 20,
  participationPoints: 5,
  testPoints: 0,
  participationTarget: 5,
  testsBestOf: null,
  groups: [],
}

/** A named CA's name: 1 to 40 characters once trimmed. At most this many per course. */
export const GROUP_NAME_MAX = 40
export const MAX_GROUPS = 10

/** "Best N of M": N is a whole number in this range. */
export const TESTS_BEST_OF_MIN = 1
export const TESTS_BEST_OF_MAX = 50

export type SettingsError = { error: 'sum' | 'range' | 'decimals' | 'shape' | 'groupName' | 'groups' }

/** A student whose CA so far is below this share of its points is slipping. */
export const SLIP_RATIO = 0.5
/** ...but only once the parts so far are worth at least this share of the CA total. */
export const SLIP_MIN_SHARE = 0.25
/** Attendance ratio below this (with enough counted sessions) is slipping. */
export const SLIP_ATTENDANCE = 0.75
export const SLIP_MIN_SESSIONS = 3

const POINT_KEYS = ['attendancePoints', 'assignmentPoints', 'participationPoints', 'testPoints'] as const
const MAX_POINTS = 100

const cents = (n: number) => Math.round(n * 100)
/** Rounds to whole cents; `+ 0` turns -0 into 0. */
const toCents = (n: number) => cents(n) / 100 + 0
const hasAtMostTwoDecimals = (n: number) => Math.abs(n * 100 - cents(n)) < 1e-6

const validBestOf = (n: number | null) =>
  n === null || (Number.isInteger(n) && n >= TESTS_BEST_OF_MIN && n <= TESTS_BEST_OF_MAX)

/**
 * The named CAs, checked: names trimmed, 1 to 40 characters and different (case ignored);
 * points 0 to 100 in cents; best N like the course's. Null: not an array of the right shape.
 */
function validateGroups(input: unknown): CaGroup[] | SettingsError {
  if (input === undefined || input === null) return []
  if (!Array.isArray(input)) return { error: 'shape' }
  if (input.length > MAX_GROUPS) return { error: 'groups' }
  const groups: CaGroup[] = []
  const names = new Set<string>()
  for (const raw of input) {
    if (typeof raw !== 'object' || raw === null) return { error: 'shape' }
    const g = raw as Record<string, unknown>
    const id = g.id ?? null
    const bestOf = g.bestOf ?? null
    if (id !== null && (typeof id !== 'string' || id === '' || id.length > 100)) return { error: 'shape' }
    if (typeof g.name !== 'string' || typeof g.points !== 'number') return { error: 'shape' }
    if (bestOf !== null && typeof bestOf !== 'number') return { error: 'shape' }
    const name = g.name.trim()
    if (name === '' || name.length > GROUP_NAME_MAX || names.has(name.toLowerCase())) return { error: 'groupName' }
    names.add(name.toLowerCase())
    // A box left blank or unreadable in the form arrives as NaN: out of range, like a wrong number.
    if (!Number.isFinite(g.points) || g.points < 0 || g.points > MAX_POINTS || !validBestOf(bestOf)) return { error: 'range' }
    if (!hasAtMostTwoDecimals(g.points)) return { error: 'decimals' }
    groups.push({ id, name, points: toCents(g.points), bestOf })
  }
  return groups
}

/**
 * Checks a course's CA settings. Numbers only: the action layer converts form strings first.
 * `testsBestOf` is null (or left out) for every test, else a whole number from 1 to 50.
 * `groups` (optional) are the named CAs; with any, the test points are their sum, whatever was
 * sent. Returns the parsed settings (known fields only) or why they were refused.
 */
export function validateSettings(input: unknown): CaSettings | SettingsError {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) return { error: 'shape' }
  const o = input as Record<string, unknown>
  const groups = validateGroups(o.groups)
  if ('error' in groups) return groups
  // With named CAs the tests part is their sum: the test points box is read-only in the form.
  const testPoints = groups.length > 0 ? groups.reduce((sum, g) => sum + cents(g.points), 0) / 100 : o.testPoints
  for (const key of ['total', 'attendancePoints', 'assignmentPoints', 'participationPoints', 'participationTarget']) {
    if (typeof o[key] !== 'number' || !Number.isFinite(o[key])) return { error: 'shape' }
  }
  if (typeof testPoints !== 'number' || !Number.isFinite(testPoints)) return { error: 'shape' }
  const bestOf = o.testsBestOf ?? null
  if (bestOf !== null && typeof bestOf !== 'number') return { error: 'shape' }
  const s: CaSettings = {
    total: o.total as number,
    attendancePoints: o.attendancePoints as number,
    assignmentPoints: o.assignmentPoints as number,
    participationPoints: o.participationPoints as number,
    testPoints,
    participationTarget: o.participationTarget as number,
    // Each named CA has its own best N.
    testsBestOf: groups.length > 0 ? null : bestOf,
    groups,
  }

  if (s.total < 1 || s.total > MAX_POINTS) return { error: 'range' }
  if (POINT_KEYS.some((k) => s[k] < 0 || s[k] > MAX_POINTS)) return { error: 'range' }
  if (!Number.isInteger(s.participationTarget) || s.participationTarget < 1 || s.participationTarget > MAX_POINTS) {
    return { error: 'range' }
  }
  if (!validBestOf(s.testsBestOf)) return { error: 'range' }
  if (!hasAtMostTwoDecimals(s.total) || POINT_KEYS.some((k) => !hasAtMostTwoDecimals(s[k]))) {
    return { error: 'decimals' }
  }
  if (POINT_KEYS.reduce((sum, k) => sum + cents(s[k]), 0) !== cents(s.total)) return { error: 'sum' }
  // Within tolerance of whole cents: hand back exactly the cents, so 0.1 + 0.2 is 0.3 and 1e-9 is 0.
  return {
    ...s,
    total: toCents(s.total),
    attendancePoints: toCents(s.attendancePoints),
    assignmentPoints: toCents(s.assignmentPoints),
    participationPoints: toCents(s.participationPoints),
    testPoints: toCents(s.testPoints),
  }
}

/** A built-in template's named CA: its name is "CA n" in the reader's language, n from 1. */
export type BuiltInTemplate = {
  id: BuiltInTemplateId
  settings: Omit<CaSettings, 'groups'> & { groups: { points: number; bestOf: number | null }[] }
}

export const BUILT_IN_TEMPLATE_IDS = ['balanced', 'testBased', 'twoCas', 'assignments', 'practical', 'testsOnly'] as const
export type BuiltInTemplateId = (typeof BUILT_IN_TEMPLATE_IDS)[number]

const base = { total: 30, participationTarget: 5, testsBestOf: null, groups: [] }

/** Ready-made CA splits, all out of 30. Names and descriptions are in the messages. */
export const BUILT_IN_TEMPLATES: readonly BuiltInTemplate[] = [
  { id: 'balanced', settings: { ...base, attendancePoints: 5, assignmentPoints: 10, participationPoints: 5, testPoints: 10 } },
  {
    id: 'testBased',
    settings: { ...base, attendancePoints: 5, assignmentPoints: 5, participationPoints: 0, testPoints: 20, testsBestOf: 2 },
  },
  {
    id: 'twoCas',
    settings: {
      ...base,
      attendancePoints: 5,
      assignmentPoints: 5,
      participationPoints: 0,
      testPoints: 20,
      groups: [
        { points: 10, bestOf: null },
        { points: 10, bestOf: null },
      ],
    },
  },
  { id: 'assignments', settings: { ...base, attendancePoints: 5, assignmentPoints: 20, participationPoints: 0, testPoints: 5 } },
  { id: 'practical', settings: { ...base, attendancePoints: 10, assignmentPoints: 15, participationPoints: 5, testPoints: 0 } },
  { id: 'testsOnly', settings: { ...base, attendancePoints: 0, assignmentPoints: 0, participationPoints: 0, testPoints: 30 } },
]

export function isBuiltInTemplateId(id: unknown): id is BuiltInTemplateId {
  return typeof id === 'string' && (BUILT_IN_TEMPLATE_IDS as readonly string[]).includes(id)
}

/** A built-in template as course settings, its named CAs called `groupName(n)` (n from 1). */
export function builtInSettings(id: BuiltInTemplateId, groupName: (n: number) => string): CaSettings {
  const template = BUILT_IN_TEMPLATES.find((t) => t.id === id)!
  return {
    ...template.settings,
    groups: template.settings.groups.map((g, i) => ({ id: null, name: groupName(i + 1), ...g })),
  }
}
