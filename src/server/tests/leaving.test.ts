import { describe, expect, it } from 'vitest'
import { judgeExit } from './leaving'

const rule = { maxExits: 3, maxAbsenceSeconds: 10 }

describe('judgeExit', () => {
  it('lets short absences under the exit limit continue', () => {
    expect(judgeExit(rule, 1, 4000)).toBe('continue')
    expect(judgeExit(rule, 1, null)).toBe('continue')
    expect(judgeExit(rule, 2, 0)).toBe('continue')
  })

  it('allows an absence of exactly S seconds and ends one just over', () => {
    expect(judgeExit(rule, 2, 10_000)).toBe('continue')
    expect(judgeExit(rule, 2, 10_001)).toBe('end_absence')
  })

  it('ends at once on the Nth exit', () => {
    expect(judgeExit(rule, 3, null)).toBe('end_exits')
    expect(judgeExit(rule, 3, 1000)).toBe('end_exits')
    expect(judgeExit(rule, 4, null)).toBe('end_exits')
  })

  it('with N = 1 the first exit ends', () => {
    expect(judgeExit({ maxExits: 1, maxAbsenceSeconds: 10 }, 1, null)).toBe('end_exits')
  })
})
