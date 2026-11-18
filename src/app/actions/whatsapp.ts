'use server'

import { revalidatePath } from 'next/cache'
import { toActionResult, type ActionResult } from '@/lib/action-result'
import { getCtx } from '@/server/auth/session'
import { AppError } from '@/server/core/errors'
import {
  createConnectCode,
  disconnectWhatsApp,
  getWhatsAppSettings,
  setWhatsAppPreference,
  type WhatsAppPrefs,
} from '@/server/whatsapp/link'
import { whatsAppConfig } from '@/server/whatsapp/config'

/** WhatsApp is optional per deployment: without its settings every write refuses with NOT_FOUND. */
function requireWhatsApp(): void {
  if (!whatsAppConfig()) throw new AppError('NOT_FOUND', 'WhatsApp is not set up')
}

/** Starts linking: the wa.me link that opens WhatsApp with the code ready to send, and when the code expires (ISO). */
export async function connectWhatsAppAction(): Promise<ActionResult<{ url: string; expiresAt: string }>> {
  return toActionResult(async () => {
    const { url, expiresAt } = await createConnectCode(await getCtx())
    return { url, expiresAt: expiresAt.toISOString() }
  })
}

/** Removes the caller's WhatsApp number; alerts go back to email and push only. */
export async function disconnectWhatsAppAction(): Promise<ActionResult<null>> {
  return toActionResult(async () => {
    const ctx = await getCtx()
    requireWhatsApp()
    await disconnectWhatsApp(ctx)
    revalidatePath('/settings')
    return null
  })
}

/** Turns one kind of WhatsApp alert on or off for the caller. */
export async function setWhatsAppPreferenceAction(key: keyof WhatsAppPrefs, on: boolean): Promise<ActionResult<null>> {
  return toActionResult(async () => {
    if (typeof on !== 'boolean') throw new AppError('VALIDATION', 'on must be a boolean')
    const ctx = await getCtx()
    requireWhatsApp()
    await setWhatsAppPreference(ctx, key, on)
    revalidatePath('/settings')
    return null
  })
}

/** The caller's WhatsApp state, for the Settings section and for polling while a link is being made. */
export async function getWhatsAppSettingsAction(): Promise<ActionResult<Awaited<ReturnType<typeof getWhatsAppSettings>>>> {
  return toActionResult(async () => getWhatsAppSettings(await getCtx()))
}
