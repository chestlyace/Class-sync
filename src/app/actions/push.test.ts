import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import type { Ctx } from '@/server/core/context'
import { AppError } from '@/server/core/errors'
import { setPushClientForTests, type PushClient } from '@/server/push/send'
import { listMyDevices } from '@/server/push/subscriptions'
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

import { removeDeviceAction, sendTestPushAction, subscribePushAction, unsubscribePushAction } from './push'

const ANDROID_CHROME =
  'Mozilla/5.0 (Linux; Android 14; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36'

const subscription = (n: string) => ({
  endpoint: `https://fcm.googleapis.com/fcm/send/action-${n}`,
  keys: { p256dh: 'BNcRdreALRFXTkOOUHK1EtK2wtaz5Ry4YfYCA_0QTpQtUbVlUls0VJXg7A8u-Ts1XbjhazAkj7I99e8QcYP7DkM', auth: 'tBHItJI5svbpez7KI4CCXg' },
  userAgent: ANDROID_CHROME,
})

describe('push Server Actions', () => {
  let db: Awaited<ReturnType<typeof createTestDb>>

  beforeAll(async () => {
    db = await createTestDb()
  })
  afterEach(() => {
    current = null
    setPushClientForTests(null)
    revalidatePath.mockReset()
  })

  it('subscribePushAction stores for the signed-in user', async () => {
    const ctx = ctxFor(db, await makeUser(db))
    current = ctx
    expect(await subscribePushAction(subscription('a'))).toEqual({ ok: true, data: null })
    expect(await listMyDevices(ctx)).toEqual([{ id: expect.any(String), label: 'Chrome on Android', createdAt: expect.any(Date) }])
  })

  it('subscribePushAction refuses a signed-out caller and an invalid subscription', async () => {
    expect(await subscribePushAction(subscription('b'))).toEqual({ ok: false, code: 'UNAUTHENTICATED' })
    current = ctxFor(db, await makeUser(db))
    const result = await subscribePushAction({ endpoint: 'http://not-https.example/x', keys: {} })
    expect(result).toMatchObject({ ok: false, code: 'VALIDATION' })
  })

  it('unsubscribePushAction and removeDeviceAction remove only the caller’s device', async () => {
    const ctx = ctxFor(db, await makeUser(db))
    current = ctx
    await subscribePushAction(subscription('c'))
    await subscribePushAction(subscription('d'))
    expect(await unsubscribePushAction(subscription('c').endpoint)).toEqual({ ok: true, data: null })
    const [left] = await listMyDevices(ctx)

    current = ctxFor(db, await makeUser(db))
    expect(await removeDeviceAction(left.id)).toEqual({ ok: false, code: 'FORBIDDEN' })
    expect(await listMyDevices(ctx)).toHaveLength(1)

    current = ctx
    expect(await removeDeviceAction(left.id)).toEqual({ ok: true, data: null })
    expect(await listMyDevices(ctx)).toEqual([])
    expect(revalidatePath).toHaveBeenCalledWith('/settings')
  })

  it('sendTestPushAction is limited to 5 per hour', async () => {
    const sent: string[] = []
    const client: PushClient = {
      async send(_sub, body) {
        sent.push(body)
      },
    }
    setPushClientForTests(client)
    const ctx = ctxFor(db, await makeUser(db))
    current = ctx
    await subscribePushAction(subscription('e'))

    for (let i = 0; i < 5; i++) {
      expect(await sendTestPushAction()).toEqual({ ok: true, data: { sent: 1 } })
    }
    expect(await sendTestPushAction()).toEqual({
      ok: false,
      code: 'CONFLICT',
      details: { reason: 'rate_limited', retryAfter: expect.any(Number) },
    })
    expect(sent).toHaveLength(5)
    expect(JSON.parse(sent[0])).toMatchObject({ kind: 'test', url: '/settings' })
  })
})
