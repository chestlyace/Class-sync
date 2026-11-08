import { describe, expect, it } from 'vitest'
import { parseDecimalInput, parseWholeInput, sumInCents } from './performance-form'

describe('parseDecimalInput', () => {
  it('reads English and French decimals', () => {
    expect(parseDecimalInput('7.25')).toBe(7.25)
    expect(parseDecimalInput(' 7,25 ')).toBe(7.25)
    expect(parseDecimalInput('30')).toBe(30)
  })

  it('refuses blank, negative and junk input', () => {
    for (const raw of ['', '  ', '-1', 'abc', '1e3', '1.', '.5', '1,2,3']) {
      expect(parseDecimalInput(raw)).toBeNaN()
    }
  })
})

describe('parseWholeInput', () => {
  it('reads whole numbers only', () => {
    expect(parseWholeInput('5')).toBe(5)
    expect(parseWholeInput('5.5')).toBeNaN()
    expect(parseWholeInput('')).toBeNaN()
  })
})

describe('sumInCents', () => {
  it('adds without float drift', () => {
    expect(sumInCents([0.1, 0.2])).toBe(30)
    expect(sumInCents([10, 10, 5])).toBe(2500)
    expect(sumInCents([3.33, 3.33, 3.34])).toBe(1000)
  })

  it('counts unreadable values as 0', () => {
    expect(sumInCents([Number.NaN, 5])).toBe(500)
  })
})
