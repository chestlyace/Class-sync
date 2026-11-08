import { describe, expect, it } from 'vitest'
import { answer, missed, score, shuffleOptions, startRound } from './practice-round'

/** A small deterministic generator (mulberry32). */
function seeded(seed: number) {
  let a = seed
  return () => {
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

describe('practice round', () => {
  it('starts as a permutation of the questions, at the first one', () => {
    const round = startRound(['a', 'b', 'c', 'd', 'e'], seeded(7))
    expect([...round.order].sort()).toEqual(['a', 'b', 'c', 'd', 'e'])
    expect(round.index).toBe(0)
    expect(round.results).toEqual({})
  })

  it('does not change the list it is given', () => {
    const ids = ['a', 'b', 'c']
    startRound(ids, seeded(3))
    expect(ids).toEqual(['a', 'b', 'c'])
  })

  it('records answers, moves on, and reports the wrong ones in round order', () => {
    let round = startRound(['a', 'b', 'c'], seeded(11))
    const [first, second, third] = round.order
    round = answer(round, first, false)
    round = answer(round, second, true)
    round = answer(round, third, false)
    expect(round.index).toBe(3)
    expect(missed(round)).toEqual([first, third])
    expect(score(round)).toEqual({ right: 1, total: 3 })
  })

  it('counts a question once, with the latest answer', () => {
    let round = startRound(['a', 'b'], seeded(1))
    round = answer(round, 'a', false)
    round = answer(round, 'a', true)
    expect(score(round)).toEqual({ right: 1, total: 2 })
    expect(missed(round)).toEqual([])
  })

  it('a new round from the missed ones holds only those', () => {
    let round = startRound(['a', 'b', 'c', 'd'], seeded(5))
    for (const [i, id] of round.order.entries()) round = answer(round, id, i % 2 === 0)
    const again = startRound(missed(round), seeded(9))
    expect([...again.order].sort()).toEqual([...missed(round)].sort())
    expect(again.order).toHaveLength(2)
    expect(score(again)).toEqual({ right: 0, total: 2 })
  })

  it('an empty round has nothing to miss', () => {
    const round = startRound([])
    expect(round.order).toEqual([])
    expect(score(round)).toEqual({ right: 0, total: 0 })
  })
})

describe('shuffleOptions', () => {
  it('returns the same options in some order, leaving the input alone', () => {
    const options = [{ id: 1 }, { id: 2 }, { id: 3 }, { id: 4 }]
    const shuffled = shuffleOptions(options, seeded(2))
    expect(shuffled).toHaveLength(4)
    expect(shuffled.map((o) => o.id).sort()).toEqual([1, 2, 3, 4])
    expect(options.map((o) => o.id)).toEqual([1, 2, 3, 4])
  })

  it('actually shuffles with a random source', () => {
    const base = Array.from({ length: 10 }, (_, i) => i)
    expect(shuffleOptions(base, seeded(42))).not.toEqual(base)
  })
})
