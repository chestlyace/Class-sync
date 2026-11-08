/**
 * The test editor's values and how they become the service's `TestInput`. Shared by the editor
 * (live total, drafts) and its Server Action. Numbers are typed as text, so "2,5" and "2.5" both
 * work; `validateTestInput` (the service) is the authority on every range and rule.
 */
import type { QuestionInput, TestInput } from '@/server/tests/rules'
import {
  DEFAULT_DURATION_MINUTES,
  DEFAULT_MAX_ABSENCE_SECONDS,
  DEFAULT_MAX_EXITS,
  DEFAULT_QUESTION_MARK,
  DEFAULT_TEST_WEIGHT,
  MCQ_OPTIONS_MIN,
} from '@/server/tests/rules'

export type EditorOption = { key: string; text: string; correct: boolean }

/** `key` only identifies the card in the editor. `mark` is '' while the test's default applies. */
export type EditorQuestion = {
  key: string
  kind: 'mcq' | 'short'
  prompt: string
  mark: string
  options: EditorOption[]
  guide: string
}

export type EditorValues = {
  title: string
  durationMinutes: string
  defaultMark: string
  shuffle: boolean
  maxExits: string
  maxAbsenceSeconds: string
  /** Weight in CA, shown as "1×". */
  weight: string
  questions: EditorQuestion[]
}

/** A saved test as `getTestForEdit` returns it (question ids are not needed by the editor). */
export type SavedTestInput = Omit<TestInput, 'questions'> & { questions: QuestionInput[] }

let keyCounter = 0
/** A key unique within the page (no `crypto.randomUUID`: it needs a secure context). */
export function newKey(): string {
  keyCounter += 1
  return `k${keyCounter}-${Math.random().toString(36).slice(2, 8)}`
}

export function blankOption(): EditorOption {
  return { key: newKey(), text: '', correct: false }
}

export function blankQuestion(kind: 'mcq' | 'short'): EditorQuestion {
  return {
    key: newKey(),
    kind,
    prompt: '',
    mark: '',
    options: kind === 'mcq' ? Array.from({ length: MCQ_OPTIONS_MIN }, blankOption) : [],
    guide: '',
  }
}

export function emptyEditorValues(): EditorValues {
  return {
    title: '',
    durationMinutes: String(DEFAULT_DURATION_MINUTES),
    defaultMark: String(DEFAULT_QUESTION_MARK),
    shuffle: true,
    maxExits: String(DEFAULT_MAX_EXITS),
    maxAbsenceSeconds: String(DEFAULT_MAX_ABSENCE_SECONDS),
    weight: String(DEFAULT_TEST_WEIGHT),
    questions: [blankQuestion('mcq')],
  }
}

/** A number as the reader types it: "1,5" in French, "1.5" in English. */
function numberText(value: number, locale: string): string {
  const text = String(value)
  return locale.startsWith('fr') ? text.replace('.', ',') : text
}

export function toEditorValues(input: SavedTestInput, locale: string): EditorValues {
  return {
    title: input.title,
    durationMinutes: String(input.durationMinutes),
    defaultMark: numberText(input.defaultMark, locale),
    shuffle: input.shuffle,
    maxExits: String(input.maxExits),
    maxAbsenceSeconds: String(input.maxAbsenceSeconds),
    weight: numberText(input.weight, locale),
    questions: input.questions.map((q) => ({
      key: newKey(),
      kind: q.kind,
      prompt: q.prompt,
      mark: q.mark === null ? '' : numberText(q.mark, locale),
      options:
        q.kind === 'mcq' ? q.options.map((o) => ({ key: newKey(), text: o.text, correct: o.correct })) : [],
      guide: q.kind === 'short' ? q.guide : '',
    })),
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * Text → number: "2,5" or "2.5" → 2.5. Blank, negative or junk → NaN, which the service refuses
 * on that field (a number of the wrong value, not a wrong shape). Non-strings pass unchanged.
 */
function toNumber(value: unknown): unknown {
  if (typeof value !== 'string') return value
  const text = value.trim().replace(',', '.')
  if (!/^\d+(\.\d+)?$/.test(text)) return Number.NaN
  return Number(text)
}

/** A question's mark: blank means the test's default (`null`). */
function toMark(value: unknown): unknown {
  if (value === null || (typeof value === 'string' && value.trim() === '')) return null
  return toNumber(value)
}

function toQuestion(value: unknown): unknown {
  if (!isRecord(value)) return value
  const base = { kind: value.kind, prompt: value.prompt, mark: toMark(value.mark) }
  if (value.kind === 'mcq') {
    const options = Array.isArray(value.options)
      ? value.options.map((o) => (isRecord(o) ? { text: o.text, correct: o.correct } : o))
      : value.options
    return { ...base, options }
  }
  if (value.kind === 'short') return { ...base, guide: value.guide }
  return value
}

/**
 * The editor's values as the service's `TestInput`: numbers parsed, blank question marks `null`,
 * editor-only fields dropped. Validation is left to the service; anything not shaped like the
 * editor's values is passed on for it to refuse.
 */
export function parseTestForm(value: unknown): unknown {
  if (!isRecord(value)) return value
  return {
    title: value.title,
    durationMinutes: toNumber(value.durationMinutes),
    defaultMark: toNumber(value.defaultMark),
    shuffle: value.shuffle,
    maxExits: toNumber(value.maxExits),
    maxAbsenceSeconds: toNumber(value.maxAbsenceSeconds),
    weight: toNumber(value.weight),
    questions: Array.isArray(value.questions) ? value.questions.map(toQuestion) : value.questions,
  }
}

/** The live total: each question's mark or the default. Null while a mark can't be read. */
export function editorTotal(values: EditorValues): number | null {
  const fallback = toNumber(values.defaultMark) as number
  let total = 0
  for (const q of values.questions) {
    const mark = q.mark.trim() === '' ? fallback : (toNumber(q.mark) as number)
    if (!Number.isFinite(mark)) return null
    total += mark
  }
  return total
}

function isEditorOption(value: unknown): value is EditorOption {
  return isRecord(value) && typeof value.key === 'string' && typeof value.text === 'string' && typeof value.correct === 'boolean'
}

function isEditorQuestion(value: unknown): value is EditorQuestion {
  return (
    isRecord(value) &&
    typeof value.key === 'string' &&
    (value.kind === 'mcq' || value.kind === 'short') &&
    typeof value.prompt === 'string' &&
    typeof value.mark === 'string' &&
    typeof value.guide === 'string' &&
    Array.isArray(value.options) &&
    value.options.every(isEditorOption)
  )
}

/**
 * A stored draft read back (it may be stale or edited by hand): null unless it has the editor
 * shape. A draft from before tests had a weight gets the default one.
 */
export function toEditorDraft(value: unknown): EditorValues | null {
  if (!isRecord(value)) return null
  const weight = value.weight === undefined ? String(DEFAULT_TEST_WEIGHT) : value.weight
  const texts = [value.title, value.durationMinutes, value.defaultMark, value.maxExits, value.maxAbsenceSeconds, weight]
  if (!texts.every((t) => typeof t === 'string') || typeof value.shuffle !== 'boolean') return null
  if (!Array.isArray(value.questions) || !value.questions.every(isEditorQuestion)) return null
  return {
    title: value.title as string,
    durationMinutes: value.durationMinutes as string,
    defaultMark: value.defaultMark as string,
    shuffle: value.shuffle,
    maxExits: value.maxExits as string,
    maxAbsenceSeconds: value.maxAbsenceSeconds as string,
    weight: weight as string,
    questions: value.questions,
  }
}

/** Where the editor keeps unsaved work: per user, per test (or per course for a new one). */
export function testDraftKey(userId: string, target: { testId: string } | { courseId: string }): string {
  const id = 'testId' in target ? target.testId : `new-${target.courseId}`
  return `clasync:test-draft:${userId}:${id}`
}
