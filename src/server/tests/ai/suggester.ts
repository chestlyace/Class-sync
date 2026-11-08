import { config } from '@/server/core/config'
import type { Locale } from '@/server/core/context'
import { fakeSuggester } from './fake'
import { createGatewaySuggester } from './gateway'

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
 * Suggests marks for a batch of answers. Answers it cannot judge are simply missing from the
 * result. It may reject (provider down, timeout, malformed output): callers catch that, store
 * nothing for the batch and let the lecturer mark by hand.
 */
export type MarkSuggester = (input: SuggestInput) => Promise<Suggestion[]>

export const FAKE_MODEL = 'fake'

let testOverride: MarkSuggester | null | undefined

/** Test-only: a suggester to use, `null` to force suggestions off, `undefined` to restore the default lookup. */
export function setMarkSuggesterForTests(s: MarkSuggester | null | undefined): void {
  testOverride = s
}

/** AI Gateway credentials: an API key, a Vercel OIDC token, or a Vercel deployment (which supplies OIDC per request). */
function hasGatewayCredentials(): boolean {
  return Boolean(process.env.AI_GATEWAY_API_KEY || process.env.VERCEL_OIDC_TOKEN || process.env.VERCEL === '1')
}

/**
 * The suggester to use, or null when AI suggestions are off (the lecturer marks by hand).
 * `AI_MARKING_MODEL=fake` selects the deterministic fake, except on Vercel production where it is refused.
 */
export function getMarkSuggester(): MarkSuggester | null {
  if (testOverride !== undefined) return testOverride
  const model = config.aiMarkingModel
  if (model === FAKE_MODEL) return process.env.VERCEL_ENV === 'production' ? null : fakeSuggester
  if (!model || !hasGatewayCredentials()) return null
  return createGatewaySuggester(model)
}
