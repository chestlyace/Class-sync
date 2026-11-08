import { describe, expect, it } from 'vitest'
import { REASON_MAX, cleanSuggestions } from './clean'

const keys = new Set(['a1', 'a2', 'a3'])
const a1 = (mark: number) => ({ key: 'a1', mark, reason: `Gave ${mark}` })

describe('cleanSuggestions', () => {
  it('rounds marks to the nearest 0.25', () => {
    expect(cleanSuggestions({ suggestions: [{ key: 'a1', mark: 2.3, reason: 'Names osmosis' }] }, keys, 4)).toEqual([
      { key: 'a1', mark: 2.25, reason: 'Names osmosis' },
    ])
    expect(cleanSuggestions({ suggestions: [{ key: 'a1', mark: 3.9, reason: 'x' }] }, keys, 4)[0].mark).toBe(4)
  })

  it('keeps marks at both ends of the range', () => {
    const out = cleanSuggestions(
      { suggestions: [{ key: 'a1', mark: 0, reason: 'x' }, { key: 'a2', mark: 4, reason: 'y' }] },
      keys,
      4,
    )
    expect(out.map((s) => s.mark)).toEqual([0, 4])
  })

  it('drops marks outside 0..max', () => {
    expect(cleanSuggestions({ suggestions: [{ key: 'a1', mark: 7, reason: 'x' }] }, keys, 4)).toEqual([])
    expect(cleanSuggestions({ suggestions: [{ key: 'a1', mark: -1, reason: 'x' }] }, keys, 4)).toEqual([])
    expect(cleanSuggestions({ suggestions: [{ key: 'a1', mark: 4.2, reason: 'x' }] }, keys, 4)).toEqual([])
  })

  it('never returns negative zero', () => {
    const [s] = cleanSuggestions({ suggestions: [{ key: 'a1', mark: -0.1, reason: 'x' }] }, keys, 4)
    expect(Object.is(s.mark, 0)).toBe(true)
  })

  it('drops non-numeric marks', () => {
    for (const mark of [Number.NaN, Number.POSITIVE_INFINITY, '2', null]) {
      expect(cleanSuggestions({ suggestions: [{ key: 'a1', mark, reason: 'x' }] }, keys, 4)).toEqual([])
    }
  })

  it('drops unknown keys', () => {
    expect(cleanSuggestions({ suggestions: [{ key: 'zz', mark: 1, reason: 'x' }] }, keys, 4)).toEqual([])
  })

  it('drops suggestions with no reason', () => {
    expect(cleanSuggestions({ suggestions: [{ key: 'a1', mark: 1, reason: '' }] }, keys, 4)).toEqual([])
    expect(cleanSuggestions({ suggestions: [{ key: 'a1', mark: 1, reason: ' \n\t ' }] }, keys, 4)).toEqual([])
    expect(cleanSuggestions({ suggestions: [{ key: 'a1', mark: 1 }] }, keys, 4)).toEqual([])
  })

  it('keeps the first suggestion for a duplicate key', () => {
    const out = cleanSuggestions({ suggestions: [a1(1), a1(2)] }, keys, 4)
    expect(out).toHaveLength(1)
    expect(out[0].mark).toBe(1)
  })

  it('makes the reason one line of at most 160 characters', () => {
    const [s] = cleanSuggestions(
      { suggestions: [{ key: 'a2', mark: 1, reason: 'line one\nline two' + 'x'.repeat(300) }] },
      keys,
      4,
    )
    expect(s.reason).toMatch(/^line one line two/)
    expect(s.reason).not.toMatch(/[\r\n]/)
    expect(s.reason.length).toBeLessThanOrEqual(REASON_MAX)
    expect(REASON_MAX).toBe(160)
  })

  it('keeps the valid suggestions when others are bad', () => {
    const out = cleanSuggestions(
      {
        suggestions: [
          { key: 'a1', mark: 7, reason: 'too high' },
          { key: 'a2', mark: 2.3, reason: 'Names osmosis' },
          { key: 'zz', mark: 1, reason: 'unknown' },
          { key: 'a3', mark: 1, reason: '' },
        ],
      },
      keys,
      4,
    )
    expect(out).toEqual([{ key: 'a2', mark: 2.25, reason: 'Names osmosis' }])
  })

  it('returns nothing for garbage', () => {
    expect(cleanSuggestions('garbage', keys, 4)).toEqual([])
    expect(cleanSuggestions(null, keys, 4)).toEqual([])
    expect(cleanSuggestions({}, keys, 4)).toEqual([])
    expect(cleanSuggestions({ suggestions: 'no' }, keys, 4)).toEqual([])
    expect(cleanSuggestions({ suggestions: [null, 3, 'x'] }, keys, 4)).toEqual([])
  })
})
