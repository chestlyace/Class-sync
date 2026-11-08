import type { MarkSuggester, Suggestion } from './suggester'

const WORD = /\p{L}{4,}/gu

function words(text: string): Set<string> {
  return new Set(Array.from(text.toLocaleLowerCase('en').matchAll(WORD), (m) => m[0]))
}

/**
 * Deterministic stand-in for the AI (unit tests and e2e, via `AI_MARKING_MODEL=fake`): full marks
 * when the answer shares a word of 4+ letters with the guide (case-insensitive), otherwise 0.
 */
export const fakeSuggester: MarkSuggester = async ({ guide, maxMark, answers }) => {
  const guideWords = words(guide)
  return answers.map(({ key, text }): Suggestion => {
    const matches = [...words(text)].some((w) => guideWords.has(w))
    return matches
      ? { key, mark: maxMark, reason: 'Matches the guide' }
      : { key, mark: 0, reason: 'Not in the guide' }
  })
}
