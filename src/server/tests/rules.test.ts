import { describe, expect, it } from 'vitest'
import {
  ANSWER_GRACE_MS,
  COMMENT_MAX,
  DEFAULT_DURATION_MINUTES,
  DEFAULT_MAX_ABSENCE_SECONDS,
  DEFAULT_MAX_EXITS,
  DEFAULT_QUESTION_MARK,
  DEVICE_STALE_MS,
  DURATION_MAX,
  DURATION_MIN,
  GUIDE_MAX,
  MAX_ABSENCE_MAX,
  MAX_ABSENCE_MIN,
  MAX_EXITS_MAX,
  MAX_EXITS_MIN,
  MAX_QUESTIONS,
  MCQ_OPTIONS_MAX,
  MCQ_OPTIONS_MIN,
  OPTION_MAX,
  PROMPT_MAX,
  QUESTION_MARK_MAX,
  SHORT_ANSWER_MAX,
  STUDENT_SYNC_MS,
  TEST_LIVE_POLL_MS,
  TITLE_MAX,
  questionMark,
  testTotal,
  validateTestInput,
} from './rules'

const valid = {
  title: 'CA 1',
  durationMinutes: 30,
  defaultMark: 2,
  shuffle: true,
  maxExits: 3,
  maxAbsenceSeconds: 10,
  questions: [
    {
      kind: 'mcq',
      prompt: 'Which organelle makes ATP?',
      mark: null,
      options: [
        { text: 'Nucleus', correct: false },
        { text: 'Mitochondrion', correct: true },
        { text: 'Ribosome', correct: false },
      ],
    },
    { kind: 'short', prompt: 'Define osmosis.', mark: 3, guide: 'Water across a membrane.' },
  ],
}

function withQuestion(index: number, patch: Record<string, unknown>) {
  return {
    ...valid,
    questions: valid.questions.map((q, i) => (i === index ? { ...q, ...patch } : q)),
  }
}
const withOptions = (texts: string[]) =>
  withQuestion(0, { options: texts.map((text, i) => ({ text, correct: i === 0 })) })
const withCorrect = (flags: boolean[]) =>
  withQuestion(0, { options: flags.map((correct, i) => ({ text: `o${i}`, correct })) })
const withGuide = (guide: string) => withQuestion(1, { guide })

describe('constants', () => {
  it('match the plan', () => {
    expect(ANSWER_GRACE_MS).toBe(120_000)
    expect(DEFAULT_DURATION_MINUTES).toBe(30)
    expect([DURATION_MIN, DURATION_MAX]).toEqual([1, 300])
    expect([DEFAULT_QUESTION_MARK, QUESTION_MARK_MAX]).toEqual([2, 100])
    expect(MAX_QUESTIONS).toBe(100)
    expect([MCQ_OPTIONS_MIN, MCQ_OPTIONS_MAX]).toEqual([2, 6])
    expect([TITLE_MAX, PROMPT_MAX, OPTION_MAX, GUIDE_MAX]).toEqual([200, 2000, 500, 4000])
    expect([SHORT_ANSWER_MAX, COMMENT_MAX]).toEqual([1000, 1000])
    expect([DEFAULT_MAX_EXITS, MAX_EXITS_MIN, MAX_EXITS_MAX]).toEqual([3, 1, 10])
    expect([DEFAULT_MAX_ABSENCE_SECONDS, MAX_ABSENCE_MIN, MAX_ABSENCE_MAX]).toEqual([10, 3, 300])
    expect([DEVICE_STALE_MS, STUDENT_SYNC_MS, TEST_LIVE_POLL_MS]).toEqual([60_000, 5_000, 3_000])
  })
})

describe('validateTestInput', () => {
  it('accepts a valid test and keeps the questions in order', () => {
    expect(validateTestInput(valid)).toMatchObject({
      title: 'CA 1',
      questions: [{ kind: 'mcq' }, { kind: 'short' }],
    })
  })

  it('trims strings and drops unknown fields', () => {
    const result = validateTestInput({
      ...withQuestion(0, {
        prompt: '  Which?  ',
        extra: 1,
        options: [
          { text: ' a ', correct: true },
          { text: 'b', correct: false },
        ],
      }),
      title: '  CA 1  ',
      extra: 'x',
    })
    expect(result).toEqual({
      title: 'CA 1',
      durationMinutes: 30,
      defaultMark: 2,
      shuffle: true,
      maxExits: 3,
      maxAbsenceSeconds: 10,
      weight: 1,
      questions: [
        {
          kind: 'mcq',
          prompt: 'Which?',
          mark: null,
          options: [
            { text: 'a', correct: true },
            { text: 'b', correct: false },
          ],
        },
        { kind: 'short', prompt: 'Define osmosis.', mark: 3, guide: 'Water across a membrane.' },
      ],
    })
  })

  it('takes the weight in CA, 0.25 to 100 in steps of 0.25, and 1 when left out', () => {
    expect(validateTestInput(valid)).toMatchObject({ weight: 1 })
    for (const weight of [0.25, 1, 2.5, 100]) {
      expect(validateTestInput({ ...valid, weight }), String(weight)).toMatchObject({ weight })
    }
    for (const weight of [0, 0.1, 0.3, -1, 100.25, 101, NaN, Infinity]) {
      expect(validateTestInput({ ...valid, weight }), String(weight)).toEqual({ error: 'weight' })
    }
    expect(validateTestInput({ ...valid, weight: '2' })).toEqual({ error: 'shape' })
    expect(validateTestInput({ ...valid, weight: null })).toEqual({ error: 'shape' })
  })

  it('refuses a blank or too long title', () => {
    expect(validateTestInput({ ...valid, title: '  ' })).toEqual({ error: 'title' })
    expect(validateTestInput({ ...valid, title: 'x'.repeat(201) })).toEqual({ error: 'title' })
    expect(validateTestInput({ ...valid, title: 'x'.repeat(200) })).not.toHaveProperty('error')
  })

  it('refuses MCQs with fewer than 2 or more than 6 options', () => {
    expect(validateTestInput(withOptions(['a']))).toEqual({ error: 'options', question: 0 })
    expect(validateTestInput(withOptions(['a', 'b', 'c', 'd', 'e', 'f', 'g']))).toEqual({
      error: 'options',
      question: 0,
    })
    expect(validateTestInput(withOptions(['a', 'b', 'c', 'd', 'e', 'f']))).not.toHaveProperty(
      'error',
    )
  })

  it('refuses blank or too long option text', () => {
    expect(validateTestInput(withOptions(['a', ' ']))).toEqual({ error: 'options', question: 0 })
    expect(validateTestInput(withOptions(['a', 'x'.repeat(501)]))).toEqual({
      error: 'options',
      question: 0,
    })
  })

  it('needs exactly one correct option', () => {
    expect(validateTestInput(withCorrect([true, true, false]))).toEqual({
      error: 'correct',
      question: 0,
    })
    expect(validateTestInput(withCorrect([false, false, false]))).toEqual({
      error: 'correct',
      question: 0,
    })
  })

  it('needs a marking guide on short answers', () => {
    expect(validateTestInput(withGuide(''))).toEqual({ error: 'guide', question: 1 })
    expect(validateTestInput(withGuide('   '))).toEqual({ error: 'guide', question: 1 })
    expect(validateTestInput(withGuide('x'.repeat(4001)))).toEqual({ error: 'guide', question: 1 })
  })

  it('refuses a blank or too long prompt', () => {
    expect(validateTestInput(withQuestion(1, { prompt: ' ' }))).toEqual({
      error: 'prompt',
      question: 1,
    })
    expect(validateTestInput(withQuestion(0, { prompt: 'x'.repeat(2001) }))).toEqual({
      error: 'prompt',
      question: 0,
    })
  })

  it('checks marks: 0.25 to 100 in 0.25 steps', () => {
    expect(validateTestInput({ ...valid, defaultMark: 0.3 })).toEqual({ error: 'mark' })
    expect(validateTestInput({ ...valid, defaultMark: 0 })).toEqual({ error: 'mark' })
    expect(validateTestInput({ ...valid, defaultMark: 100.25 })).toEqual({ error: 'mark' })
    expect(validateTestInput({ ...valid, defaultMark: 0.25 })).not.toHaveProperty('error')
    expect(validateTestInput(withQuestion(1, { mark: 2.6 }))).toEqual({
      error: 'mark',
      question: 1,
    })
    expect(validateTestInput(withQuestion(1, { mark: 0 }))).toEqual({ error: 'mark', question: 1 })
  })

  it('checks the leaving rule: 1-10 exits, 3-300 seconds', () => {
    expect(validateTestInput({ ...valid, maxExits: 0 })).toEqual({ error: 'leaving' })
    expect(validateTestInput({ ...valid, maxExits: 11 })).toEqual({ error: 'leaving' })
    expect(validateTestInput({ ...valid, maxExits: 2.5 })).toEqual({ error: 'leaving' })
    expect(validateTestInput({ ...valid, maxAbsenceSeconds: 2 })).toEqual({ error: 'leaving' })
    expect(validateTestInput({ ...valid, maxAbsenceSeconds: 301 })).toEqual({ error: 'leaving' })
  })

  it('checks the duration: whole minutes, 1-300', () => {
    expect(validateTestInput({ ...valid, durationMinutes: 301 })).toEqual({ error: 'duration' })
    expect(validateTestInput({ ...valid, durationMinutes: 0 })).toEqual({ error: 'duration' })
    expect(validateTestInput({ ...valid, durationMinutes: 1.5 })).toEqual({ error: 'duration' })
    expect(validateTestInput({ ...valid, durationMinutes: Number.NaN })).toEqual({
      error: 'duration',
    })
  })

  it('needs 1 to 100 questions', () => {
    expect(validateTestInput({ ...valid, questions: [] })).toEqual({ error: 'questions' })
    const many = Array.from({ length: 101 }, () => valid.questions[1])
    expect(validateTestInput({ ...valid, questions: many })).toEqual({ error: 'questions' })
    expect(validateTestInput({ ...valid, questions: many.slice(0, 100) })).not.toHaveProperty(
      'error',
    )
  })

  it('reports a malformed payload as shape', () => {
    expect(validateTestInput(null)).toEqual({ error: 'shape' })
    expect(validateTestInput('test')).toEqual({ error: 'shape' })
    expect(validateTestInput({ ...valid, title: 3 })).toEqual({ error: 'shape' })
    expect(validateTestInput({ ...valid, durationMinutes: '30' })).toEqual({ error: 'shape' })
    expect(validateTestInput({ ...valid, shuffle: 'yes' })).toEqual({ error: 'shape' })
    expect(validateTestInput({ ...valid, questions: 'many' })).toEqual({ error: 'shape' })
    expect(validateTestInput(withQuestion(0, { kind: 'essay' }))).toEqual({ error: 'shape' })
    expect(validateTestInput(withQuestion(0, { options: 'a,b' }))).toEqual({ error: 'shape' })
    expect(validateTestInput(withQuestion(0, { options: [{ text: 'a' }, null] }))).toEqual({
      error: 'shape',
    })
    expect(validateTestInput(withQuestion(1, { mark: '2' }))).toEqual({ error: 'shape' })
    expect(validateTestInput(withQuestion(1, { guide: undefined }))).toEqual({ error: 'shape' })
  })
})

describe('questionMark and testTotal', () => {
  it('uses the default unless the question overrides it', () => {
    expect(questionMark({ mark: null }, 2)).toBe(2)
    expect(questionMark({ mark: 3.5 }, 2)).toBe(3.5)
  })

  it('sums the question marks', () => {
    expect(
      testTotal({
        defaultMark: 2,
        questions: [{ mark: null }, { mark: 3 }, { mark: null }] as never,
      }),
    ).toBe(7)
    expect(
      testTotal({ defaultMark: 0.25, questions: [{ mark: null }, { mark: 0.5 }] as never }),
    ).toBe(0.75)
  })
})
