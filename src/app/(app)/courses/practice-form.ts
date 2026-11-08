import { formString } from '@/lib/form-data'

/**
 * The practice question form's fields as the service's input: `kind`, `prompt`, `explanation`,
 * then `guide` (short) or the repeated `option` texts with `correct` naming the ticked one by
 * position (multiple choice). Validation is the service's (`parsePracticeInput`).
 */
export function parsePracticeForm(data: FormData): unknown {
  const kind = formString(data, 'kind')
  const base = { kind, prompt: formString(data, 'prompt'), explanation: formString(data, 'explanation') }
  if (kind === 'short') return { ...base, guide: formString(data, 'guide') }
  const correct = formString(data, 'correct')
  const options = data
    .getAll('option')
    .map((text, i) => ({ text: typeof text === 'string' ? text : '', isCorrect: String(i) === correct }))
  return { ...base, options }
}
