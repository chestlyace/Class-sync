import { readAiConfig } from '@/server/ai/config'
import { aiCapReached } from '@/server/ai/usage'
import { now } from '@/server/core/clock'
import { AppError } from '@/server/core/errors'
import type { Db } from '@/server/db'
import { hitRateLimit, type RateLimitRule } from '@/server/lib/rate-limit'

/**
 * Burst allowance for test short-answer correction: one lecturer, across all their courses, gets
 * this many suggestion requests in a fixed 10-minute window. The shared monthly cap is checked too.
 */
export const TEST_SUGGEST_RATE_LIMIT: RateLimitRule = { max: 12, windowMs: 10 * 60_000 }

/** Opaque counter key: ids only, never a question, prompt, student or answer. */
export function testSuggestRateLimitKey(lecturerId: string): string {
  return `ai:test-suggest:${lecturerId}`
}

/**
 * Refuses a correction request before any provider call. A reached monthly cap is CONFLICT
 * `{ reason: 'cap' }`, as for assignment marking; too many requests in the window is CONFLICT
 * `{ reason: 'rate_limited', retryAfter }` (seconds to the window's end), as for test pushes.
 */
export async function assertCanSuggestTestMarks(db: Db, lecturerId: string, at: Date = now()): Promise<void> {
  if (await aiCapReached(db, at, readAiConfig().monthlyCap)) {
    throw new AppError('CONFLICT', 'The monthly limit for AI mark suggestions is reached', { reason: 'cap' })
  }
  const { limited, retryAfter } = await hitRateLimit(db, testSuggestRateLimitKey(lecturerId), TEST_SUGGEST_RATE_LIMIT, at)
  if (limited) {
    throw new AppError('CONFLICT', 'Too many AI mark suggestion requests', { reason: 'rate_limited', retryAfter })
  }
}
