import { describe, expect, it } from 'vitest'
import { parsePracticeForm } from './practice-form'

function form(entries: [string, string][]): FormData {
  const data = new FormData()
  for (const [k, v] of entries) data.append(k, v)
  return data
}

describe('parsePracticeForm', () => {
  it('reads a multiple choice question, the ticked option being the right one', () => {
    expect(
      parsePracticeForm(
        form([
          ['kind', 'mcq'],
          ['prompt', 'Which?'],
          ['explanation', ''],
          ['option', 'A'],
          ['option', 'B'],
          ['option', 'C'],
          ['correct', '1'],
        ]),
      ),
    ).toEqual({
      kind: 'mcq',
      prompt: 'Which?',
      explanation: '',
      options: [
        { text: 'A', isCorrect: false },
        { text: 'B', isCorrect: true },
        { text: 'C', isCorrect: false },
      ],
    })
  })

  it('marks nothing right when nothing is ticked, for the service to refuse', () => {
    const value = parsePracticeForm(form([['kind', 'mcq'], ['prompt', 'Q'], ['option', 'A'], ['option', 'B']])) as {
      options: { isCorrect: boolean }[]
    }
    expect(value.options.some((o) => o.isCorrect)).toBe(false)
  })

  it('reads a short answer with its guide', () => {
    expect(
      parsePracticeForm(form([['kind', 'short'], ['prompt', 'Define X'], ['guide', 'X is Y'], ['explanation', 'Why']])),
    ).toEqual({ kind: 'short', prompt: 'Define X', explanation: 'Why', guide: 'X is Y' })
  })

  it('passes an unknown kind on for the service to refuse', () => {
    expect(parsePracticeForm(form([['kind', 'essay']]))).toMatchObject({ kind: 'essay' })
  })
})
