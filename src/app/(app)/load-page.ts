import { redirect } from 'next/navigation'
import { toActionResult, type ActionResult } from '@/lib/action-result'
import { getCtx } from '@/server/auth/session'
import type { Ctx } from '@/server/core/context'

/**
 * Loads a page's data through services. Service errors (FORBIDDEN, NOT_FOUND, …) come back as a
 * failed result for the page to render with <ErrorState>; a lost session goes to sign-in.
 */
export async function loadPage<T>(fn: (ctx: Ctx) => Promise<T>): Promise<ActionResult<T>> {
  const result = await toActionResult(async () => fn(await getCtx()))
  if (!result.ok && result.code === 'UNAUTHENTICATED') redirect('/sign-in')
  return result
}
