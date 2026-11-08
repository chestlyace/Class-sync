import { createHash } from 'node:crypto'
import type { QuestionKind } from './rules'

/**
 * A student's order for `ids`: sorted by SHA-256 of `seed:id`. The same seed always gives the same
 * order whatever order the ids come in; options use the seed `seed:questionId`.
 */
export function orderFor(seed: string, ids: string[]): string[] {
  const keyed = ids.map((id) => ({
    id,
    key: createHash('sha256').update(`${seed}:${id}`).digest('hex'),
  }))
  keyed.sort((a, b) =>
    a.key < b.key ? -1 : a.key > b.key ? 1 : a.id < b.id ? -1 : a.id > b.id ? 1 : 0,
  )
  return keyed.map((k) => k.id)
}

export type ScoringQuestion = {
  id: string
  kind: QuestionKind
  mark: number
  correctOptionId: string | null
}

/** `mark` is the lecturer's confirmed mark for a short answer (ignored for MCQs). */
export type ScoringAnswer = { optionId: string | null; text: string | null; mark: number | null }

export type AttemptScore = {
  score: number
  outOf: number
  mcqCorrect: number
  mcqCount: number
  pendingShort: number
  perQuestion: { questionId: string; mark: number | null }[]
}

function round2(n: number): number {
  return Math.round(n * 100) / 100
}

/**
 * Scores one attempt. MCQ: its mark when the chosen option is the correct one, else 0 (no
 * negative marking, no partial credit). Short answer: 0 when missing or blank; otherwise the
 * confirmed mark, or `null` (pending) until the lecturer confirms it.
 */
export function scoreAttempt(
  questions: ScoringQuestion[],
  answers: Map<string, ScoringAnswer>,
): AttemptScore {
  let sum = 0
  let outOf = 0
  let mcqCorrect = 0
  let mcqCount = 0
  let pendingShort = 0
  const perQuestion: AttemptScore['perQuestion'] = []

  for (const q of questions) {
    outOf += q.mark
    const answer = answers.get(q.id)
    let mark: number | null
    if (q.kind === 'mcq') {
      mcqCount += 1
      const right = q.correctOptionId !== null && answer?.optionId === q.correctOptionId
      if (right) mcqCorrect += 1
      mark = right ? q.mark : 0
    } else if (!answer?.text?.trim()) {
      mark = 0
    } else {
      mark = answer.mark
      if (mark === null) pendingShort += 1
    }
    if (mark !== null) sum += mark
    perQuestion.push({ questionId: q.id, mark })
  }

  return {
    score: round2(sum),
    outOf: round2(outOf),
    mcqCorrect,
    mcqCount,
    pendingShort,
    perQuestion,
  }
}
