import type { Ctx } from '@/server/core/context'
import type { Occurrence } from './occurrences'

/** Generated links are gone (replaced by the course classroom); only pasted links resolve for now. */
export async function ensureGeneratedMeetingUrl(ctx: Ctx, occurrence: Occurrence): Promise<string | null> {
  void ctx
  void occurrence
  return null
}

/** A pasted link wins; a generated one is created only when this occurrence asks for it. */
export async function resolveMeetingUrl(
  ctx: Ctx,
  occurrence: Occurrence,
  pastedUrl: string | null,
): Promise<string | null> {
  if (pastedUrl !== null) return pastedUrl
  return ensureGeneratedMeetingUrl(ctx, occurrence)
}
