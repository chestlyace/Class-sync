import { generateText, Output, type LanguageModel } from 'ai'
import { z } from 'zod'
import { createBedrockModel } from '@/server/ai/bedrock'
import { FAKE_MODEL, isAssignmentMarkingOn, readAiConfig } from '@/server/ai/config'
import { FEEDBACK_MAX } from '../rules'
import { fakeAssignmentSuggester } from './fake'
import type { MarkingInput } from './inputs'
import { buildSystemPrompt, buildUserContent } from './prompt'

const TIMEOUT_MS = 50_000
const TRANSCRIPT_MAX = 20_000
/** Room for the transcript (about 12,000 characters asked for), the feedback and the JSON around them. */
const MAX_OUTPUT_TOKENS = 8192

export type MarkingSuggestion = {
  mark: number
  feedback: string | null
  transcript: string
  inputTokens: number
  outputTokens: number
  model: string
}

/**
 * Suggests a mark, feedback and transcript for one submission. Never a confirmed mark: a lecturer
 * reviews it. Rejects with AssignmentSuggesterError. `signal` bounds the call (by default 50 s).
 */
export type AssignmentSuggester = (input: MarkingInput, opts?: { signal?: AbortSignal }) => Promise<MarkingSuggestion>

export type SuggesterFailure = 'timeout' | 'auth' | 'rate_limit' | 'invalid_output' | 'other'

/**
 * A failed suggestion. It carries only the provider error's name, a category and the HTTP status:
 * never the provider's message nor a cause, because those can quote the request (the student's
 * work). Safe to log in full.
 */
export class AssignmentSuggesterError extends Error {
  override name = 'AssignmentSuggesterError'
  constructor(
    readonly providerName: string,
    readonly category: SuggesterFailure,
    readonly status: number | null,
  ) {
    super(`AI mark suggestion failed (${providerName}, ${category}${status !== null ? `, status ${status}` : ''})`)
  }
}

// Kept loose (no min/max): range and rounding are enforced by cleanSuggestion.
const schema = z.object({ transcript: z.string(), mark: z.number(), feedback: z.string() })

function statusOf(error: unknown): number | null {
  if (typeof error !== 'object' || error === null) return null
  const status = (error as { statusCode?: unknown }).statusCode ?? (error as { status?: unknown }).status
  return typeof status === 'number' ? status : null
}

/** Name, category and status of a provider error; a retry wrapper is judged by its last error. */
function describeFailure(error: unknown): AssignmentSuggesterError {
  const name = error instanceof Error ? error.name.slice(0, 80) : 'unknown'
  const last =
    typeof error === 'object' && error !== null && 'lastError' in error ? (error as { lastError: unknown }).lastError : error
  const lastName = last instanceof Error ? last.name : ''
  const status = statusOf(last) ?? statusOf(error)
  let category: SuggesterFailure = 'other'
  if (/NoObjectGenerated|TypeValidation|JSONParse/i.test(name)) category = 'invalid_output'
  else if (/timeout|abort/i.test(`${name} ${lastName}`) || status === 408 || status === 504) category = 'timeout'
  else if (/authentication|forbidden|accessdenied/i.test(lastName) || status === 401 || status === 403) category = 'auth'
  else if (/ratelimit|throttl/i.test(lastName) || status === 429) category = 'rate_limit'
  return new AssignmentSuggesterError(name, category, status)
}

/**
 * The model's object made safe to store: mark rounded to the nearest 0.25 and kept within
 * 0..maxMark (anything else is null), feedback trimmed (blank is null) and cut to FEEDBACK_MAX,
 * transcript cut to 20,000 characters.
 */
export function cleanSuggestion(
  raw: unknown,
  maxMark: number,
): { mark: number; feedback: string | null; transcript: string } | null {
  if (typeof raw !== 'object' || raw === null) return null
  const { mark, feedback, transcript } = raw as Record<string, unknown>
  if (typeof mark !== 'number' || !Number.isFinite(mark)) return null
  if (mark < 0 || mark > maxMark) return null
  // Rounding can push a mark within range past a maximum that is not a multiple of 0.25 (10.2 -> 10.25).
  const rounded = Math.min(Math.round(mark * 4) / 4, Math.floor(maxMark * 4) / 4)
  const trimmed = typeof feedback === 'string' ? feedback.trim() : ''
  return {
    mark: rounded,
    feedback: trimmed ? trimmed.slice(0, FEEDBACK_MAX) : null,
    transcript: typeof transcript === 'string' ? transcript.slice(0, TRANSCRIPT_MAX) : '',
  }
}

/** A suggester backed by `model` (Bedrock in production, a mock in tests); `modelId` is recorded with each suggestion. */
export function createModelSuggester(model: LanguageModel, modelId: string): AssignmentSuggester {
  return async (input, opts) => {
    let output: unknown
    let usage: { inputTokens: number | undefined; outputTokens: number | undefined }
    try {
      const result = await generateText({
        model,
        output: Output.object({ schema }),
        system: buildSystemPrompt(),
        messages: [{ role: 'user', content: buildUserContent(input) }],
        // No temperature: Haiku 5.5 answers a non-default sampling parameter with a 400.
        maxOutputTokens: MAX_OUTPUT_TOKENS,
        providerOptions: {
          amazonBedrock: {
            // Always the forced JSON tool: Bedrock's native structured output (output_config.format)
            // is incompatible with PDF citations, which buildUserContent turns on for PDFs.
            structuredOutputMode: 'jsonTool',
            // Haiku 5.5 thinks by default; the provider sends `thinking: {type: 'disabled'}` to
            // Converse, so the whole output budget goes to the transcript and the JSON. Accepted
            // only at effort high or below; we send no effort (the model's default is medium).
            reasoningConfig: { type: 'disabled' },
          },
        },
        abortSignal: opts?.signal ?? AbortSignal.timeout(TIMEOUT_MS),
      })
      output = result.output
      usage = result.usage
    } catch (error) {
      throw describeFailure(error)
    }
    const cleaned = cleanSuggestion(output, input.maxMark)
    if (!cleaned) throw new AssignmentSuggesterError('InvalidOutput', 'invalid_output', null)
    return { ...cleaned, inputTokens: usage.inputTokens ?? 0, outputTokens: usage.outputTokens ?? 0, model: modelId }
  }
}

let testOverride: AssignmentSuggester | null | undefined

/** Test-only: a suggester to use, `null` to force suggestions off, `undefined` to restore the default lookup. */
export function setAssignmentSuggesterForTests(s: AssignmentSuggester | null | undefined): void {
  testOverride = s
}

/** The suggester to use, or null when AI marking is off (the lecturer marks by hand). */
export function getAssignmentSuggester(): AssignmentSuggester | null {
  if (testOverride !== undefined) return testOverride
  if (!isAssignmentMarkingOn()) return null
  const cfg = readAiConfig()
  if (cfg.assignmentModel === FAKE_MODEL) return fakeAssignmentSuggester
  return createModelSuggester(createBedrockModel(cfg), cfg.assignmentModel)
}
