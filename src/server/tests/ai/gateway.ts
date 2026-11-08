import { generateText, Output, type LanguageModel } from 'ai'
import { z } from 'zod'
import { cleanSuggestions } from './clean'
import { buildMarkingPrompt } from './prompt'
import type { MarkSuggester } from './suggester'

const TIMEOUT_MS = 30_000

// Kept loose on purpose (no min/max): range, rounding, keys and reasons are enforced by cleanSuggestions,
// so one bad item is dropped instead of failing the whole batch.
const schema = z.object({
  suggestions: z.array(z.object({ key: z.string(), mark: z.number(), reason: z.string() })),
})

function summarize(error: unknown): string {
  if (error instanceof Error) return `${error.name}: ${error.message}`.slice(0, 300)
  return 'unknown error'
}

/**
 * A suggester backed by the Vercel AI Gateway. `model` is a Gateway "provider/model" string from
 * config (tests pass a mock model). Rejects with a plain Error when the call fails or times out;
 * the error carries no cause, because provider errors can include the request body (student answers).
 */
export function createGatewaySuggester(
  model: LanguageModel,
  { timeoutMs = TIMEOUT_MS }: { timeoutMs?: number } = {},
): MarkSuggester {
  return async (input) => {
    if (input.answers.length === 0) return []
    const { system, prompt } = buildMarkingPrompt(input)
    let output: unknown
    try {
      const result = await generateText({
        model,
        output: Output.object({ schema }),
        system,
        prompt,
        temperature: 0,
        abortSignal: AbortSignal.timeout(timeoutMs),
      })
      output = result.output
    } catch (error) {
      throw new Error(`AI mark suggestions failed (${summarize(error)})`)
    }
    return cleanSuggestions(output, new Set(input.answers.map((a) => a.key)), input.maxMark)
  }
}
