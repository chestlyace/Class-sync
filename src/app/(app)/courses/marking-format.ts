import { MARK_STEP } from '@/server/assignments/rules'

/** A mark typed or picked as "3.5" or the French "3,5"; blank, negative or junk → NaN. */
export function parseMarkInput(raw: string): number {
  const text = raw.trim().replace(',', '.')
  if (!/^\d+(\.\d+)?$/.test(text)) return Number.NaN
  return Number(text)
}

/** Every mark the picker offers: 0 to `max` in steps of 0.25. */
export function markSteps(max: number): number[] {
  const count = Math.floor(max / MARK_STEP + 1e-9)
  return Array.from({ length: count + 1 }, (_, i) => i * MARK_STEP)
}

/** Whether opening the question should ask for AI suggestions: AI is on and an answer has neither. */
export function needsSuggestions(
  aiAvailable: boolean,
  answers: { suggestion: { mark: number; reason: string } | null; mark: number | null }[],
): boolean {
  return aiAvailable && answers.some((a) => a.suggestion === null && a.mark === null)
}
