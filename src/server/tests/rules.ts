import { MARK_STEP, isValidMark } from '@/server/assignments/rules'

/** Answers received up to this long after the test (or the attempt) ended still count. */
export const ANSWER_GRACE_MS = 120_000
export const DEFAULT_DURATION_MINUTES = 30
export const DURATION_MIN = 1
export const DURATION_MAX = 300
export const DEFAULT_QUESTION_MARK = 2
export const QUESTION_MARK_MAX = 100
export const MAX_QUESTIONS = 100
export const MCQ_OPTIONS_MIN = 2
export const MCQ_OPTIONS_MAX = 6
export const TITLE_MAX = 200
export const PROMPT_MAX = 2000
export const OPTION_MAX = 500
export const GUIDE_MAX = 4000
export const SHORT_ANSWER_MAX = 1000
export const COMMENT_MAX = 1000
export const DEFAULT_MAX_EXITS = 3
export const MAX_EXITS_MIN = 1
export const MAX_EXITS_MAX = 10
export const DEFAULT_MAX_ABSENCE_SECONDS = 10
export const MAX_ABSENCE_MIN = 3
export const MAX_ABSENCE_MAX = 300
/** Another device may take over an attempt once the active one has been silent this long. */
export const DEVICE_STALE_MS = 60_000
export const STUDENT_SYNC_MS = 5_000
export const TEST_LIVE_POLL_MS = 3_000

export type QuestionKind = 'mcq' | 'short'

/** `mark: null` means the test's default mark. */
export type QuestionInput =
  | {
      kind: 'mcq'
      prompt: string
      mark: number | null
      options: { text: string; correct: boolean }[]
    }
  | { kind: 'short'; prompt: string; mark: number | null; guide: string }

export type TestInput = {
  title: string
  durationMinutes: number
  defaultMark: number
  shuffle: boolean
  maxExits: number
  maxAbsenceSeconds: number
  questions: QuestionInput[]
}

/** `question` is the 0-based index of the question at fault. */
export type TestInputError = {
  error:
    | 'shape'
    | 'title'
    | 'duration'
    | 'mark'
    | 'leaving'
    | 'questions'
    | 'prompt'
    | 'options'
    | 'correct'
    | 'guide'
  question?: number
}

const SHAPE: TestInputError = { error: 'shape' }

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function lengthWithin(text: string, max: number): boolean {
  return text.length >= 1 && text.length <= max
}

function isIntegerWithin(value: number, min: number, max: number): boolean {
  return Number.isInteger(value) && value >= min && value <= max
}

/** A question mark is 0.25 to 100 in 0.25 steps (0 is not a mark a question can carry). */
function isQuestionMark(mark: number): boolean {
  return mark >= MARK_STEP && isValidMark(mark, QUESTION_MARK_MAX)
}

/** Checks types only and trims strings; `null` when anything has the wrong type. */
function parseQuestion(value: unknown): QuestionInput | null {
  if (!isRecord(value) || typeof value.prompt !== 'string') return null
  const mark = value.mark
  if (mark !== null && typeof mark !== 'number') return null
  const prompt = value.prompt.trim()
  if (value.kind === 'mcq') {
    if (!Array.isArray(value.options)) return null
    const options: { text: string; correct: boolean }[] = []
    for (const option of value.options) {
      if (!isRecord(option) || typeof option.text !== 'string') return null
      if (typeof option.correct !== 'boolean') return null
      options.push({ text: option.text.trim(), correct: option.correct })
    }
    return { kind: 'mcq', prompt, mark, options }
  }
  if (value.kind === 'short') {
    if (typeof value.guide !== 'string') return null
    return { kind: 'short', prompt, mark, guide: value.guide.trim() }
  }
  return null
}

function parseShape(input: unknown): TestInput | null {
  if (!isRecord(input)) return null
  const { title, durationMinutes, defaultMark, shuffle, maxExits, maxAbsenceSeconds, questions } =
    input
  if (typeof title !== 'string' || typeof shuffle !== 'boolean') return null
  for (const n of [durationMinutes, defaultMark, maxExits, maxAbsenceSeconds]) {
    if (typeof n !== 'number') return null
  }
  if (!Array.isArray(questions)) return null
  const parsed: QuestionInput[] = []
  for (const q of questions) {
    const question = parseQuestion(q)
    if (!question) return null
    parsed.push(question)
  }
  return {
    title: title.trim(),
    durationMinutes: durationMinutes as number,
    defaultMark: defaultMark as number,
    shuffle,
    maxExits: maxExits as number,
    maxAbsenceSeconds: maxAbsenceSeconds as number,
    questions: parsed,
  }
}

function questionError(q: QuestionInput, index: number): TestInputError | null {
  if (!lengthWithin(q.prompt, PROMPT_MAX)) return { error: 'prompt', question: index }
  if (q.mark !== null && !isQuestionMark(q.mark)) return { error: 'mark', question: index }
  if (q.kind === 'mcq') {
    const { options } = q
    if (options.length < MCQ_OPTIONS_MIN || options.length > MCQ_OPTIONS_MAX) {
      return { error: 'options', question: index }
    }
    if (options.some((o) => !lengthWithin(o.text, OPTION_MAX))) {
      return { error: 'options', question: index }
    }
    if (options.filter((o) => o.correct).length !== 1) return { error: 'correct', question: index }
    return null
  }
  if (!lengthWithin(q.guide, GUIDE_MAX)) return { error: 'guide', question: index }
  return null
}

/**
 * Validates a whole test as the editor saves it. Strings are trimmed and unknown fields dropped;
 * numbers must already be numbers (the actions convert form strings).
 */
export function validateTestInput(input: unknown): TestInput | TestInputError {
  const test = parseShape(input)
  if (!test) return SHAPE
  if (!lengthWithin(test.title, TITLE_MAX)) return { error: 'title' }
  if (!isIntegerWithin(test.durationMinutes, DURATION_MIN, DURATION_MAX))
    return { error: 'duration' }
  if (!isQuestionMark(test.defaultMark)) return { error: 'mark' }
  if (
    !isIntegerWithin(test.maxExits, MAX_EXITS_MIN, MAX_EXITS_MAX) ||
    !isIntegerWithin(test.maxAbsenceSeconds, MAX_ABSENCE_MIN, MAX_ABSENCE_MAX)
  ) {
    return { error: 'leaving' }
  }
  if (test.questions.length < 1 || test.questions.length > MAX_QUESTIONS) {
    return { error: 'questions' }
  }
  for (const [index, q] of test.questions.entries()) {
    const error = questionError(q, index)
    if (error) return error
  }
  return test
}

/** The question's own mark, or the test's default when it has none. */
export function questionMark(q: { mark: number | null }, defaultMark: number): number {
  return q.mark ?? defaultMark
}

/** Sum of the question marks. Marks are 0.25 steps, so the sum is exact in floating point. */
export function testTotal(t: Pick<TestInput, 'defaultMark' | 'questions'>): number {
  return t.questions.reduce((sum, q) => sum + questionMark(q, t.defaultMark), 0)
}
