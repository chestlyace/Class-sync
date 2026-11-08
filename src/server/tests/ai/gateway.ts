import { generateText, Output, type LanguageModel } from 'ai'
import { z } from 'zod'
import { cleanSuggestions } from './clean'
import { buildMarkingPrompt } from './prompt'
import type { MarkSuggester, Suggestion, SuggestInput } from './suggester'

const TIMEOUT_MS = 30_000

// Kept loose on purpose (no min/max): range, rounding, keys and reasons are enforced by cleanSuggestions,
// so one bad item is dropped instead of failing the whole batch.
const schema = z.object({
  suggestions: z.array(z.object({ key: z.string(), mark: z.number(), reason: z.string() })),
})

/** The most answers sent in one model call; a larger input is split into calls of this size. */
export const MAX_ANSWERS_PER_CALL = 20

export type SuggesterFailure = 'timeout' | 'auth' | 'rate_limit' | 'other'

/**
 * A failed suggestion call. It carries only the provider error's name, a category and the HTTP
 * status: never the provider's message nor a cause, because those can quote the request (student
 * answers). Safe to log in full.
 */
export class SuggesterError extends Error {
  override name = 'SuggesterError'
  constructor(
    readonly providerName: string,
    readonly category: SuggesterFailure,
    readonly status: number | null,
  ) {
    super(`AI mark suggestions failed (${providerName}, ${category}${status !== null ? `, status ${status}` : ''})`)
  }
}

/** Reasoning models reject (or warn about) a temperature; others get 0 for steady marks. */
function isReasoningModel(model: LanguageModel): boolean {
  const id = typeof model === 'string' ? model : model.modelId
  return /^openai\/(gpt-5|o)/.test(id)
}

function statusOf(error: unknown): number | null {
  if (typeof error !== 'object' || error === null) return null
  const status = (error as { statusCode?: unknown }).statusCode ?? (error as { status?: unknown }).status
  return typeof status === 'number' ? status : null
}

/** Name, category and status of a provider error; a retry wrapper is judged by its last error. */
function describeFailure(error: unknown): SuggesterError {
  const name = error instanceof Error ? error.name.slice(0, 80) : 'unknown'
  const last =
    typeof error === 'object' && error !== null && 'lastError' in error ? (error as { lastError: unknown }).lastError : error
  const lastName = last instanceof Error ? last.name : ''
  const status = statusOf(last) ?? statusOf(error)
  let category: SuggesterFailure = 'other'
  if (/timeout|abort/i.test(`${name} ${lastName}`) || status === 408 || status === 504) category = 'timeout'
  else if (/authentication|forbidden/i.test(lastName) || status === 401 || status === 403) category = 'auth'
  else if (/ratelimit/i.test(lastName) || status === 429) category = 'rate_limit'
  return new SuggesterError(name, category, status)
}

/**
 * A suggester backed by the Vercel AI Gateway. `model` is a Gateway "provider/model" string from
 * config (tests pass a mock model). Sends at most MAX_ANSWERS_PER_CALL answers per call (in
 * parallel when there are more). Rejects with a SuggesterError when a call fails or times out, or
 * when the output does not parse as the expected shape; within parsed output, bad items are dropped.
 */
export function createGatewaySuggester(
  model: LanguageModel,
  { timeoutMs = TIMEOUT_MS }: { timeoutMs?: number } = {},
): MarkSuggester {
  const temperature = isReasoningModel(model) ? undefined : 0

  async function suggestChunk(input: SuggestInput): Promise<Suggestion[]> {
    const { system, prompt } = buildMarkingPrompt(input)
    let output: unknown
    try {
      const result = await generateText({
        model,
        output: Output.object({ schema }),
        system,
        prompt,
        ...(temperature === undefined ? {} : { temperature }),
        abortSignal: AbortSignal.timeout(timeoutMs),
      })
      output = result.output
    } catch (error) {
      throw describeFailure(error)
    }
    return cleanSuggestions(output, new Set(input.answers.map((a) => a.key)), input.maxMark)
  }

  return async (input) => {
    if (input.answers.length === 0) return []
    const chunks: SuggestInput[] = []
    for (let i = 0; i < input.answers.length; i += MAX_ANSWERS_PER_CALL) {
      chunks.push({ ...input, answers: input.answers.slice(i, i + MAX_ANSWERS_PER_CALL) })
    }
    return (await Promise.all(chunks.map(suggestChunk))).flat()
  }
}
