/**
 * One round of practice on a device. Pure: the runner keeps a `Round` in state, and shuffling
 * takes a random source so tests can be deterministic.
 */
export type Round = {
  /** The questions in the order they are asked. */
  order: string[]
  /** Questions answered so far, which is also the position of the next one. */
  index: number
  /** The latest right/wrong per answered question. */
  results: Record<string, boolean>
}

/** A shuffled copy (Fisher-Yates); the input is left alone. */
export function shuffleOptions<T>(options: T[], rand: () => number = Math.random): T[] {
  const copy = [...options]
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1))
    ;[copy[i], copy[j]] = [copy[j], copy[i]]
  }
  return copy
}

export function startRound(questionIds: string[], rand: () => number = Math.random): Round {
  return { order: shuffleOptions(questionIds, rand), index: 0, results: {} }
}

/** Records the answer to a question and moves on to the one after it. */
export function answer(round: Round, questionId: string, correct: boolean): Round {
  const position = round.order.indexOf(questionId)
  return {
    ...round,
    index: position < 0 ? round.index : Math.max(round.index, position + 1),
    results: { ...round.results, [questionId]: correct },
  }
}

/** The questions answered wrongly, in round order. */
export function missed(round: Round): string[] {
  return round.order.filter((id) => round.results[id] === false)
}

export function score(round: Round): { right: number; total: number } {
  return { right: round.order.filter((id) => round.results[id] === true).length, total: round.order.length }
}
