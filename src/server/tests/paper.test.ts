import { describe, expect, it } from 'vitest'
import { orderFor, scoreAttempt, type ScoringAnswer, type ScoringQuestion } from './paper'

const ids = Array.from({ length: 10 }, (_, i) => `00000000-0000-4000-8000-00000000000${i}`)

describe('orderFor', () => {
  it('is stable whatever the input order', () => {
    expect(orderFor('s1', ids)).toEqual(orderFor('s1', [...ids].reverse()))
    expect(orderFor('s1', ids)).toEqual(orderFor('s1', ids))
  })

  it('differs with the seed', () => {
    expect(orderFor('s1', ids)).not.toEqual(orderFor('s2', ids))
  })

  it('keeps every id exactly once and does not touch its input', () => {
    const input = [...ids]
    const out = orderFor('s1', input)
    expect(new Set(out)).toEqual(new Set(ids))
    expect(out).toHaveLength(ids.length)
    expect(input).toEqual(ids)
  })

  it('handles empty and single lists', () => {
    expect(orderFor('s1', [])).toEqual([])
    expect(orderFor('s1', ['a'])).toEqual(['a'])
  })
})

describe('scoreAttempt', () => {
  const qs: ScoringQuestion[] = [
    { id: 'q1', kind: 'mcq', mark: 2, correctOptionId: 'o1' },
    { id: 'q2', kind: 'mcq', mark: 3, correctOptionId: 'o5' },
    { id: 'q3', kind: 'short', mark: 4, correctOptionId: null },
    { id: 'q4', kind: 'short', mark: 2, correctOptionId: null },
  ]

  function answers(entries: Record<string, Partial<ScoringAnswer>>): Map<string, ScoringAnswer> {
    return new Map(
      Object.entries(entries).map(([id, a]) => [
        id,
        { optionId: null, text: null, mark: null, ...a },
      ]),
    )
  }

  it('scores MCQs automatically and uses confirmed short marks; blank short answers get 0', () => {
    const result = scoreAttempt(
      qs,
      answers({
        q1: { optionId: 'o1' },
        q2: { optionId: 'o4' },
        q3: { text: 'osmosis', mark: 3.5 },
        q4: { text: '  ' },
      }),
    )
    expect(result).toMatchObject({
      score: 5.5,
      outOf: 11,
      mcqCorrect: 1,
      mcqCount: 2,
      pendingShort: 0,
    })
    expect(result.perQuestion).toEqual([
      { questionId: 'q1', mark: 2 },
      { questionId: 'q2', mark: 0 },
      { questionId: 'q3', mark: 3.5 },
      { questionId: 'q4', mark: 0 },
    ])
  })

  it('leaves an unconfirmed short answer pending', () => {
    const result = scoreAttempt(qs, answers({ q3: { text: 'osmosis', mark: null } }))
    expect(result).toMatchObject({ score: 0, pendingShort: 1 })
    expect(result.perQuestion.find((p) => p.questionId === 'q3')).toEqual({
      questionId: 'q3',
      mark: null,
    })
  })

  it('never answered scores 0 with nothing pending', () => {
    const result = scoreAttempt(qs, new Map())
    expect(result.score).toBe(0)
    expect(result).toMatchObject({ outOf: 11, mcqCorrect: 0, mcqCount: 2, pendingShort: 0 })
  })

  it('rounds the sum to 2 decimals at the end', () => {
    const many: ScoringQuestion[] = Array.from({ length: 3 }, (_, i) => ({
      id: `s${i}`,
      kind: 'short',
      mark: 1,
      correctOptionId: null,
    }))
    const result = scoreAttempt(
      many,
      answers({
        s0: { text: 'a', mark: 0.1 },
        s1: { text: 'b', mark: 0.2 },
        s2: { text: 'c', mark: 0.3 },
      }),
    )
    expect(result.score).toBe(0.6)
  })
})
