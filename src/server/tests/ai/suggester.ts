import { createBedrockModel } from '@/server/ai/bedrock'
import { FAKE_MODEL, isTestMarkingOn, readAiConfig } from '@/server/ai/config'
import type { Locale } from '@/server/core/context'
import { fakeSuggester } from './fake'
import { createModelSuggester } from './model'

/**
 * One short-answer question and a batch of anonymous answers. Nothing here identifies a student:
 * `key` is an opaque id chosen by the caller (never a name, matricule or email).
 */
export type SuggestInput = {
  prompt: string
  guide: string
  maxMark: number
  /** The lecturer's language; reasons are written in it. */
  locale: Locale
  answers: { key: string; text: string }[]
}

/** A suggested mark (0..maxMark, in 0.25 steps) and a one-line reason. Never a confirmed mark. */
export type Suggestion = { key: string; mark: number; reason: string }

/**
 * Suggests marks for a batch of answers. It rejects when the provider fails or times out, or when
 * the output cannot be parsed as a list of suggestions at all: callers catch that, store nothing
 * for the batch and let the lecturer mark by hand. Within parsed output, marks are rounded to the
 * nearest 0.25 and a bad item (unknown or repeated key, mark outside 0..maxMark, empty reason) is
 * dropped, so answers it cannot judge are simply missing from the result.
 */
export type MarkSuggester = (input: SuggestInput, opts?: SuggestOptions) => Promise<Suggestion[]>

/** Tokens one model call used, as the provider reported them (0 when it reported none). */
export type SuggestUsage = { inputTokens: number; outputTokens: number }

/** `onUsage` is called once per model call that returned, so the caller can log what it is billed. */
export type SuggestOptions = { onUsage?: (usage: SuggestUsage) => void }

let testOverride: MarkSuggester | null | undefined

/** Test-only: a suggester to use, `null` to force suggestions off, `undefined` to restore the default lookup. */
export function setMarkSuggesterForTests(s: MarkSuggester | null | undefined): void {
  testOverride = s
}

/**
 * The suggester to use, or null when AI suggestions are off (the lecturer marks by hand). Claude on
 * Bedrock, signed in like assignment marking (OIDC role on Vercel, access key on Heroku).
 * `AI_MARKING_MODEL=fake` selects the deterministic fake, except in production where it is refused.
 */
export function getMarkSuggester(): MarkSuggester | null {
  if (testOverride !== undefined) return testOverride
  if (!isTestMarkingOn()) return null
  const cfg = readAiConfig()
  if (cfg.testModel === FAKE_MODEL) return fakeSuggester
  return createModelSuggester(createBedrockModel(cfg, cfg.testModel))
}
