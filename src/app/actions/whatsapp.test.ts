import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Ctx } from '@/server/core/context'
import { AppError } from '@/server/core/errors'
import { createConnectCode, getWhatsAppSettings, handleInboundMessage } from '@/server/whatsapp/link'
import { setWhatsAppProviderForTests } from '@/server/whatsapp/provider'
import { createTestDb } from '@/test/db'
import { ctxFor, makeUser } from '@/test/factories'

let current: Ctx | null = null
vi.mock('@/server/auth/session', () => ({
  getCtx: async () => {
    if (!current) throw new AppError('UNAUTHENTICATED', 'Not signed in')
    return current
  },
}))
const revalidatePath = vi.fn()
vi.mock('next/cache', () => ({ revalidatePath: (path: string) => revalidatePath(path) }))

import {
  connectWhatsAppAction,
  disconnectWhatsAppAction,
  getWhatsAppSettingsAction,
  setWhatsAppPreferenceAction,
} from './whatsapp'

function configure() {
  vi.stubEnv('WHATSAPP_AWS_REGION', 'eu-west-1')
  vi.stubEnv('WHATSAPP_AWS_ROLE_ARN', 'arn:aws:iam::1:role/x')
  vi.stubEnv('WHATSAPP_PHONE_NUMBER_ID', 'phone-number-id-1')
  vi.stubEnv('WHATSAPP_DISPLAY_NUMBER', '+1 555 010 0000')
  vi.stubEnv('WHATSAPP_SNS_TOPIC_ARN', 'arn:aws:sns:eu-west-1:1:t')
}

const PHONE = '+237612345412'

/** Links `PHONE` to the user the way a real "JOIN <code>" message does. */
async function link(ctx: Ctx) {
  const { code } = await createConnectCode(ctx)
  await handleInboundMessage(ctx.db, { from: PHONE, text: `JOIN ${code}`, at: new Date() })
}

function unconfigure() {
  for (const name of [
    'WHATSAPP_AWS_REGION',
    'WHATSAPP_AWS_ROLE_ARN',
    'WHATSAPP_PHONE_NUMBER_ID',
    'WHATSAPP_DISPLAY_NUMBER',
    'WHATSAPP_SNS_TOPIC_ARN',
  ])
    vi.stubEnv(name, '')
}

describe('WhatsApp Server Actions', () => {
  let db: Awaited<ReturnType<typeof createTestDb>>

  beforeAll(async () => {
    db = await createTestDb()
  })
  beforeEach(() => {
    configure()
    setWhatsAppProviderForTests({
      sendTemplate: async () => ({ messageId: 'x' }),
      sendText: async () => ({ messageId: 'm' }),
    })
  })
  afterEach(() => {
    current = null
    setWhatsAppProviderForTests(null)
    vi.unstubAllEnvs()
    revalidatePath.mockReset()
  })

  it('connectWhatsAppAction returns a wa.me link and its expiry', async () => {
    current = ctxFor(db, await makeUser(db))
    const result = await connectWhatsAppAction()
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.data.url).toMatch(/^https:\/\/wa\.me\/15550100000\?text=JOIN%20[A-Z0-9]{6}$/)
    expect(new Date(result.data.expiresAt).getTime()).toBeGreaterThan(Date.now())
  })

  it('disconnectWhatsAppAction removes the caller’s link', async () => {
    const ctx = ctxFor(db, await makeUser(db))
    current = ctx
    await link(ctx)
    expect((await getWhatsAppSettings(ctx)).maskedPhone).not.toBeNull()
    expect(await disconnectWhatsAppAction()).toEqual({ ok: true, data: null })
    expect((await getWhatsAppSettings(ctx)).maskedPhone).toBeNull()
  })

  it('setWhatsAppPreferenceAction persists a toggle and rejects bad input', async () => {
    const ctx = ctxFor(db, await makeUser(db))
    current = ctx
    expect(await setWhatsAppPreferenceAction('results', false)).toEqual({ ok: true, data: null })
    const { prefs } = await getWhatsAppSettings(ctx)
    expect(prefs.results).toBe(false)
    expect(prefs.tests).toBe(true)
    expect(await setWhatsAppPreferenceAction('nope' as 'results', true)).toMatchObject({ ok: false, code: 'VALIDATION' })
    expect(await setWhatsAppPreferenceAction('results', 'yes' as unknown as boolean)).toMatchObject({
      ok: false,
      code: 'VALIDATION',
    })
  })

  it('getWhatsAppSettingsAction returns the masked number and preferences', async () => {
    const ctx = ctxFor(db, await makeUser(db))
    current = ctx
    await link(ctx)
    const result = await getWhatsAppSettingsAction()
    expect(result).toMatchObject({ ok: true, data: { available: true, maskedPhone: '+237 6•• ••• 412' } })
  })

  it('refuses a signed-out caller', async () => {
    expect(await connectWhatsAppAction()).toEqual({ ok: false, code: 'UNAUTHENTICATED' })
    expect(await disconnectWhatsAppAction()).toEqual({ ok: false, code: 'UNAUTHENTICATED' })
    expect(await setWhatsAppPreferenceAction('tests', true)).toEqual({ ok: false, code: 'UNAUTHENTICATED' })
    expect(await getWhatsAppSettingsAction()).toEqual({ ok: false, code: 'UNAUTHENTICATED' })
  })

  it('returns the not-available error when WhatsApp is not configured', async () => {
    unconfigure()
    current = ctxFor(db, await makeUser(db))
    expect(await connectWhatsAppAction()).toEqual({ ok: false, code: 'NOT_FOUND' })
    expect(await disconnectWhatsAppAction()).toEqual({ ok: false, code: 'NOT_FOUND' })
    expect(await setWhatsAppPreferenceAction('tests', true)).toEqual({ ok: false, code: 'NOT_FOUND' })
    // Polling reports availability rather than failing.
    expect(await getWhatsAppSettingsAction()).toMatchObject({ ok: true, data: { available: false } })
  })
})
