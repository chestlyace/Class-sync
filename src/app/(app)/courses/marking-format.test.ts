import { describe, expect, it } from 'vitest'
import { markSteps, needsSuggestions, parseMarkInput } from './marking-format'

describe('marking helpers', () => {
  it('parseMarkInput reads "3.5" and the French "3,5"; anything else is NaN', () => {
    expect(parseMarkInput('3.5')).toBe(3.5)
    expect(parseMarkInput(' 3,5 ')).toBe(3.5)
    expect(parseMarkInput('0')).toBe(0)
    expect(parseMarkInput('4')).toBe(4)
    for (const junk of ['', ' ', 'abc', '-1', '1e1', '2,5,0', '.5', '3.']) expect(parseMarkInput(junk)).toBeNaN()
  })

  it('markSteps runs from 0 to the maximum in 0.25 steps', () => {
    expect(markSteps(1)).toEqual([0, 0.25, 0.5, 0.75, 1])
    expect(markSteps(2.5)).toHaveLength(11)
    expect(markSteps(2.5).at(-1)).toBe(2.5)
    expect(markSteps(100)).toHaveLength(401)
  })

  it('needsSuggestions: AI on and some answer has neither a suggestion nor a mark', () => {
    const open = { suggestion: null, mark: null }
    const suggested = { suggestion: { mark: 1, reason: 'x' }, mark: null }
    const marked = { suggestion: null, mark: 2 }
    expect(needsSuggestions(true, [suggested, open])).toBe(true)
    expect(needsSuggestions(true, [suggested, marked])).toBe(false)
    expect(needsSuggestions(false, [open])).toBe(false)
    expect(needsSuggestions(true, [])).toBe(false)
  })
})
