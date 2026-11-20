import type { AssignmentSuggester } from './suggester'

/** Deterministic stand-in for the model (unit tests and e2e, via `AI_ASSIGNMENT_MODEL=fake`). */
export const fakeAssignmentSuggester: AssignmentSuggester = async (input) => ({
  mark: Math.round((input.maxMark / 2) * 4) / 4,
  feedback: 'Fake feedback',
  transcript: input.studentText?.trim() ? input.studentText.slice(0, 200) : '[fake transcript]',
  inputTokens: 0,
  outputTokens: 0,
  model: 'fake',
})
