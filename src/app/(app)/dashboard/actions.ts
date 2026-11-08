'use server'

import { revalidatePath } from 'next/cache'
import { cookies } from 'next/headers'
import { toActionResult, type ActionResult } from '@/lib/action-result'
import { getCtx } from '@/server/auth/session'
import { SETUP_DISMISSED_COOKIE, SETUP_DISMISSED_MAX_AGE } from './setup-cookie'

/** Hides the dashboard's setup checklist for good (in this browser). */
export async function dismissSetupAction(): Promise<ActionResult<null>> {
  return toActionResult(async () => {
    await getCtx() // signed-in users only
    const store = await cookies()
    store.set(SETUP_DISMISSED_COOKIE, '1', {
      path: '/',
      maxAge: SETUP_DISMISSED_MAX_AGE,
      sameSite: 'lax',
      httpOnly: true,
    })
    revalidatePath('/dashboard')
    return null
  })
}
