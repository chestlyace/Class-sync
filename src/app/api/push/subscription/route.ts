import { getCtx } from '@/server/auth/session'
import { subscribe } from '@/server/push/subscriptions'
import { handleJson, readJson } from '../../tests/route-kit'

export const dynamic = 'force-dynamic'

/**
 * Stores a push subscription for the signed-in user. Body: `PushSubscription.toJSON()` plus
 * `userAgent`. The service worker calls it on `pushsubscriptionchange`, when the browser renews
 * a subscription and there is no page to run a Server Action from. Signed out: 401; an invalid
 * subscription: 400.
 */
export async function POST(request: Request) {
  return handleJson(request, 'push/subscription', async () => subscribe(await getCtx(), await readJson(request)))
}
