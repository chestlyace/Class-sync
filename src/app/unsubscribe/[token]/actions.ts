'use server'

import { unsubscribeLinkToken } from '@/server/broadcasts/unsubscribe'

/** The unsubscribe button. No session: the token in the link is the proof. */
export async function unsubscribeAction(token: string): Promise<'unsubscribed' | 'unknown'> {
  if (typeof token !== 'string') return 'unknown'
  return unsubscribeLinkToken(token)
}
