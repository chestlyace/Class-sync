import { notFound } from 'next/navigation'
import type { ActionResult } from '@/lib/action-result'
import type { Ctx } from '@/server/core/context'
import { loadPage } from '../load-page'

/**
 * loadPage for the admin area: NOT_FOUND (a non-admin, or no such person) becomes the app's
 * normal not-found page, so the admin area never shows that it exists.
 */
export async function loadAdminPage<T>(fn: (ctx: Ctx) => Promise<T>): Promise<ActionResult<T>> {
  const result = await loadPage(fn)
  if (!result.ok && result.code === 'NOT_FOUND') notFound()
  return result
}
