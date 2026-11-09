'use server'

import { revalidatePath } from 'next/cache'
import { toActionResult, type ActionResult } from '@/lib/action-result'
import { parsePosition } from '@/lib/position'
import { getCtx } from '@/server/auth/session'
import { AppError } from '@/server/core/errors'
import {
  createAccessToken,
  disconnectApp,
  revokeAccessToken,
  TOKEN_EXPIRY_DAYS,
  TOKEN_NAME_MAX,
  type TokenExpiryDays,
} from '@/server/mcp/connections'
import { setSchoolLocation } from '@/server/schools/service'

/** Sets a school's campus to where the lecturer is standing. The service checks who may do it. */
export async function setSchoolLocationAction(schoolId: string, position: unknown): Promise<ActionResult<null>> {
  return toActionResult(async () => {
    const parsed = parsePosition(position)
    if (typeof schoolId !== 'string' || !parsed) {
      throw new AppError('VALIDATION', 'Invalid location', { fields: ['location'] })
    }
    await setSchoolLocation(await getCtx(), schoolId, { latitude: parsed.latitude, longitude: parsed.longitude })
    revalidatePath('/settings')
    return null
  })
}

function parseExpiry(value: FormDataEntryValue | null): TokenExpiryDays | undefined {
  if (value === 'never') return null
  return TOKEN_EXPIRY_DAYS.find((d) => d !== null && String(d) === value)
}

/**
 * Creates a personal access token for an assistant (lecturers only). The key comes back once,
 * here, and is never shown again.
 */
export async function createAccessTokenAction(
  _prev: ActionResult<{ key: string; name: string }> | null,
  data: FormData,
): Promise<ActionResult<{ key: string; name: string }>> {
  return toActionResult(async () => {
    const name = String(data.get('name') ?? '').trim()
    const expiresInDays = parseExpiry(data.get('expiresInDays'))
    const fields = [
      ...(name.length < 1 || name.length > TOKEN_NAME_MAX ? ['name'] : []),
      ...(expiresInDays === undefined ? ['expiresInDays'] : []),
    ]
    if (fields.length > 0 || expiresInDays === undefined) {
      throw new AppError('VALIDATION', 'Invalid token', { fields })
    }
    const { key } = await createAccessToken(await getCtx(), { name, expiresInDays })
    revalidatePath('/settings')
    return { key, name }
  })
}

/** Revokes one of the lecturer's personal access tokens. */
export async function revokeAccessTokenAction(_prev: ActionResult<unknown> | null, data: FormData): Promise<ActionResult<null>> {
  return toActionResult(async () => {
    await revokeAccessToken(await getCtx(), String(data.get('id') ?? ''))
    revalidatePath('/settings')
    return null
  })
}

/** Disconnects an assistant the lecturer allowed: its consent and tokens go at once. */
export async function disconnectAppAction(_prev: ActionResult<unknown> | null, data: FormData): Promise<ActionResult<null>> {
  return toActionResult(async () => {
    await disconnectApp(await getCtx(), String(data.get('clientId') ?? ''))
    revalidatePath('/settings')
    return null
  })
}
