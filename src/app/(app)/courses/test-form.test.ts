import { describe, expect, it } from 'vitest'
import { validateTestInput } from '@/server/tests/rules'
import {
  blankQuestion,
  editorTotal,
  emptyEditorValues,
  parseTestForm,
  toEditorDraft,
  toEditorValues,
  type EditorValues,
} from './test-form'

function values(over: Partial<EditorValues> = {}): EditorValues {
  return {
    title: 'CA 1',
    durationMinutes: '30',
    defaultMark: '2',
    shuffle: true,
    maxExits: '3',
    maxAbsenceSeconds: '10',
    weight: '1',
    questions: [
      {
        key: 'a',
        kind: 'mcq',
        prompt: 'What is 2 + 2?',
        mark: '',
        options: [
          { key: 'o1', text: '3', correct: false },
          { key: 'o2', text: '4', correct: true },
        ],
        guide: '',
      },
      { key: 'b', kind: 'short', prompt: 'Define osmosis.', mark: '2,5', options: [], guide: 'Water across a membrane.' },
    ],
    ...over,
  }
}

describe('parseTestForm', () => {
  it('accepts ".5", "5." and ",5" as numbers, and still refuses junk', () => {
    const mark = (defaultMark: string) => (parseTestForm(values({ defaultMark })) as { defaultMark: number }).defaultMark
    expect(mark('.5')).toBe(0.5)
    expect(mark(',5')).toBe(0.5)
    expect(mark('5.')).toBe(5)
    expect(mark('5,')).toBe(5)
    expect(mark(' 2 ')).toBe(2)
    for (const junk of ['.', ',', '', '5..', '1.2.3', '-1', '1e3', 'x']) expect(mark(junk)).toBeNaN()
  })

  it('turns "2,5" and "2.5" into 2.5 and a blank question mark into null (the default)', () => {
    const parsed = parseTestForm(values({ defaultMark: '2.5', weight: '1,5' })) as Record<string, unknown>
    expect(parsed).toEqual({
      title: 'CA 1',
      durationMinutes: 30,
      defaultMark: 2.5,
      shuffle: true,
      maxExits: 3,
      maxAbsenceSeconds: 10,
      weight: 1.5,
      questions: [
        {
          kind: 'mcq',
          prompt: 'What is 2 + 2?',
          mark: null,
          options: [
            { text: '3', correct: false },
            { text: '4', correct: true },
          ],
        },
        { kind: 'short', prompt: 'Define osmosis.', mark: 2.5, guide: 'Water across a membrane.' },
      ],
    })
    expect('error' in validateTestInput(parsed)).toBe(false)
  })

  it('a non-numeric duration stays a value the service refuses as duration', () => {
    expect(validateTestInput(parseTestForm(values({ durationMinutes: 'half an hour' })))).toEqual({ error: 'duration' })
    expect(validateTestInput(parseTestForm(values({ durationMinutes: '' })))).toEqual({ error: 'duration' })
    expect(validateTestInput(parseTestForm(values({ durationMinutes: '-5' })))).toEqual({ error: 'duration' })
  })

  it('a junk question mark is refused as mark on that question; a junk default mark as mark', () => {
    const junk = values()
    junk.questions[1] = { ...junk.questions[1], mark: 'two' }
    expect(validateTestInput(parseTestForm(junk))).toEqual({ error: 'mark', question: 1 })
    expect(validateTestInput(parseTestForm(values({ defaultMark: '' })))).toEqual({ error: 'mark' })
  })

  it('a junk or blank weight is refused as weight', () => {
    expect(validateTestInput(parseTestForm(values({ weight: 'heavy' })))).toEqual({ error: 'weight' })
    expect(validateTestInput(parseTestForm(values({ weight: '' })))).toEqual({ error: 'weight' })
    expect(validateTestInput(parseTestForm(values({ weight: '0,3' })))).toEqual({ error: 'weight' })
  })

  it('a junk leaving rule is refused as leaving', () => {
    expect(validateTestInput(parseTestForm(values({ maxExits: 'x' })))).toEqual({ error: 'leaving' })
  })

  it('drops the editor-only fields: option keys, a short answer\'s options, an MCQ\'s guide', () => {
    const parsed = parseTestForm(values()) as { questions: Record<string, unknown>[] }
    expect(parsed.questions[0]).not.toHaveProperty('guide')
    expect(parsed.questions[0]).not.toHaveProperty('key')
    expect(parsed.questions[1]).not.toHaveProperty('options')
  })

  it('anything that is not the editor shape is passed on for the service to refuse as shape', () => {
    expect(validateTestInput(parseTestForm(null))).toEqual({ error: 'shape' })
    expect(validateTestInput(parseTestForm('a test'))).toEqual({ error: 'shape' })
    expect(validateTestInput(parseTestForm({ ...values(), questions: 'none' }))).toEqual({ error: 'shape' })
    expect(validateTestInput(parseTestForm({ ...values(), questions: [{ kind: 'essay', prompt: 'x' }] }))).toEqual({
      error: 'shape',
    })
  })
})

describe('editorTotal', () => {
  it('sums each question mark, the default where blank, read in either language', () => {
    expect(editorTotal(values())).toBe(4.5) // 2 (default) + 2.5
    expect(editorTotal(values({ defaultMark: '1,5' }))).toBe(4)
  })

  it('is null while a mark cannot be read', () => {
    expect(editorTotal(values({ defaultMark: 'x' }))).toBeNull()
  })
})

describe('editor values', () => {
  it('a new test starts with the plan defaults and one empty MCQ with two options', () => {
    const empty = emptyEditorValues()
    expect(empty).toMatchObject({
      title: '',
      durationMinutes: '30',
      defaultMark: '2',
      shuffle: true,
      maxExits: '3',
      maxAbsenceSeconds: '10',
      weight: '1',
    })
    expect(empty.questions).toHaveLength(1)
    expect(empty.questions[0]).toMatchObject({ kind: 'mcq', mark: '' })
    expect(empty.questions[0].options).toHaveLength(2)
    expect(blankQuestion('short')).toMatchObject({ kind: 'short', guide: '', options: [] })
  })

  it('a saved test opens with its values as text, null marks blank, in the reader\'s decimal', () => {
    const editor = toEditorValues(
      {
        title: 'CA 1',
        durationMinutes: 45,
        defaultMark: 1.5,
        shuffle: false,
        maxExits: 2,
        maxAbsenceSeconds: 20,
        weight: 2.5,
        questions: [
          { kind: 'mcq', prompt: 'P', mark: null, options: [{ text: 'A', correct: true }, { text: 'B', correct: false }] },
          { kind: 'short', prompt: 'S', mark: 2.5, guide: 'G' },
        ],
      },
      'fr',
    )
    expect(editor).toMatchObject({
      durationMinutes: '45',
      defaultMark: '1,5',
      shuffle: false,
      maxExits: '2',
      maxAbsenceSeconds: '20',
      weight: '2,5',
    })
    expect(editor.questions.map((q) => [q.kind, q.mark, q.guide])).toEqual([
      ['mcq', '', ''],
      ['short', '2,5', 'G'],
    ])
    expect(editor.questions[0].options.map((o) => [o.text, o.correct])).toEqual([
      ['A', true],
      ['B', false],
    ])
    // Round trip: what the editor sends back is the same test.
    expect(validateTestInput(parseTestForm(editor))).toMatchObject({
      defaultMark: 1.5,
      weight: 2.5,
      questions: [{ mark: null }, { mark: 2.5 }],
    })
  })

  it('a stored draft is read back only when it has the editor shape', () => {
    const draft = values()
    expect(toEditorDraft(JSON.parse(JSON.stringify(draft)))).toEqual(draft)
    expect(toEditorDraft(null)).toBeNull()
    expect(toEditorDraft({ ...draft, questions: 'x' })).toBeNull()
    expect(toEditorDraft({ ...draft, title: 3 })).toBeNull()
    expect(toEditorDraft({ ...draft, weight: 2 })).toBeNull()
    // A draft saved before tests had a weight opens with the default.
    const { weight: _old, ...beforeWeights } = draft
    void _old
    expect(toEditorDraft(beforeWeights)).toEqual({ ...draft, weight: '1' })
    expect(toEditorDraft({ ...draft, questions: [{ ...draft.questions[0], kind: 'essay' }] })).toBeNull()
    expect(toEditorDraft({ ...draft, questions: [{ ...draft.questions[0], options: [{ text: 1 }] }] })).toBeNull()
  })
})
