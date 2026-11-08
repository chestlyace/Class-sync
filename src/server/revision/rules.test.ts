import { describe, expect, it } from 'vitest'
import { parsePracticeInput } from './rules'

const mcq = (over: Record<string, unknown> = {}) => ({
  kind: 'mcq',
  prompt: '  Which organelle makes ATP?  ',
  options: [
    { text: ' Mitochondrion ', isCorrect: true },
    { text: 'Ribosome', isCorrect: false },
  ],
  explanation: '  Cellular respiration.  ',
  ...over,
})

const fieldsOf = (raw: unknown) => {
  const r = parsePracticeInput(raw)
  return r.ok ? null : r.fields
}

describe('parsePracticeInput', () => {
  it('returns a valid MCQ trimmed', () => {
    expect(parsePracticeInput(mcq())).toEqual({
      ok: true,
      value: {
        kind: 'mcq',
        prompt: 'Which organelle makes ATP?',
        options: [
          { text: 'Mitochondrion', isCorrect: true },
          { text: 'Ribosome', isCorrect: false },
        ],
        explanation: 'Cellular respiration.',
      },
    })
  })

  it('returns a valid short question trimmed, an empty explanation becoming null', () => {
    expect(parsePracticeInput({ kind: 'short', prompt: ' What is osmosis? ', guide: ' Water moves. ', explanation: '  ' })).toEqual({
      ok: true,
      value: { kind: 'short', prompt: 'What is osmosis?', guide: 'Water moves.', explanation: null },
    })
    const noExplanation = parsePracticeInput({ kind: 'short', prompt: 'Q', guide: 'G' })
    expect(noExplanation).toMatchObject({ ok: true, value: { explanation: null } })
  })

  it('rejects an MCQ with fewer than 2 or more than 6 options', () => {
    expect(fieldsOf(mcq({ options: [{ text: 'Only', isCorrect: true }] }))).toContain('options')
    const seven = Array.from({ length: 7 }, (_, i) => ({ text: `o${i}`, isCorrect: i === 0 }))
    expect(fieldsOf(mcq({ options: seven }))).toContain('options')
  })

  it('rejects an MCQ without exactly one correct option', () => {
    const two = [
      { text: 'A', isCorrect: true },
      { text: 'B', isCorrect: true },
    ]
    const none = [
      { text: 'A', isCorrect: false },
      { text: 'B', isCorrect: false },
    ]
    expect(fieldsOf(mcq({ options: two }))).toContain('options')
    expect(fieldsOf(mcq({ options: none }))).toContain('options')
  })

  it('rejects an empty or over-long option', () => {
    const empty = [
      { text: '  ', isCorrect: true },
      { text: 'B', isCorrect: false },
    ]
    const long = [
      { text: 'a'.repeat(501), isCorrect: true },
      { text: 'B', isCorrect: false },
    ]
    expect(fieldsOf(mcq({ options: empty }))).toContain('options')
    expect(fieldsOf(mcq({ options: long }))).toContain('options')
  })

  it('rejects a short question without a guide', () => {
    expect(fieldsOf({ kind: 'short', prompt: 'Q', guide: '  ' })).toContain('guide')
    expect(fieldsOf({ kind: 'short', prompt: 'Q' })).toContain('guide')
    expect(fieldsOf({ kind: 'short', prompt: 'Q', guide: 'g'.repeat(4001) })).toContain('guide')
  })

  it('rejects a bad prompt, explanation or kind', () => {
    expect(fieldsOf(mcq({ prompt: ' ' }))).toContain('prompt')
    expect(fieldsOf(mcq({ prompt: 'p'.repeat(2001) }))).toContain('prompt')
    expect(fieldsOf(mcq({ explanation: 'e'.repeat(2001) }))).toEqual(['explanation'])
    expect(parsePracticeInput(mcq({ explanation: 'e'.repeat(2000) })).ok).toBe(true)
    expect(fieldsOf({ kind: 'essay', prompt: 'Q' })).toEqual(['kind'])
    expect(fieldsOf(null)).toEqual(['kind'])
  })
})
