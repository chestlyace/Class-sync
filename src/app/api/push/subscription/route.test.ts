import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import type { Ctx } from '@/server/core/context'
import { AppError } from '@/server/core/errors'
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

import { POST } from './route'

const APP = 'http://clasync.localhost:3000'
const IPHONE_SAFARI =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1'

function post(body: unknown, origin: string | null = APP) {
  const headers: Record<string, string> = { host: 'clasync.localhost:3000', 'content-type': 'application/json' }
  if (origin !== null) headers.origin = origin
  return POST(
    new Request(`${APP}/api/push/subscription`, { method: 'POST', headers, body: JSON.stringify(body) }),
  )
}

const subscription = (n: string) => ({
  endpoint: `https://fcm.googleapis.com/fcm/send/device-${n}`,
  keys: { p256dh: 'BNcRdreALRFXTkOOUHK1EtK2wtaz5Ry4YfYCA_0QTpQtUbVlUls0VJXg7A8u-Ts1XbjhazAkj7I99e8QcYP7DkM', auth: 'tBHItJI5svbpez7KI4CCXg' },
  userAgent: IPHONE_SAFARI,
})

describe('POST /api/push/subscription (the service worker re-subscribes here)', () => {
  let db: Awaited<ReturnType<typeof createTestDb>>

  beforeAll(async () => {
    db = await createTestDb()
  })
  afterEach(() => {
    current = null
  })

  it('401 when signed out', async () => {
    const res = await post(subscription('a'))
    expect(res.status).toBe(401)
    expect(await res.json()).toEqual({ ok: false, code: 'UNAUTHENTICATED' })
  })

  it('stores a subscription for the signed-in user', async () => {
    const ctx = ctxFor(db, await makeUser(db))
    current = ctx
    const res = await post(subscription('b'))
    expect(res.status).toBe(200)
    expect(res.headers.get('cache-control')).toBe('no-store')
    const body = await res.json()
    expect(body).toEqual({ ok: true, data: { id: expect.any(String) } })
    expect(await listMyDevices(ctx)).toEqual([{ id: body.data.id, label: 'Safari on iPhone', createdAt: expect.any(Date) }])
  })

  it('is 400 for an invalid subscription and stores nothing', async () => {
    const ctx = ctxFor(db, await makeUser(db))
    current = ctx
    const res = await post({ ...subscription('c'), endpoint: 'http://insecure.example/push' })
    expect(res.status).toBe(400)
    expect((await res.json()).code).toBe('VALIDATION')
    expect(await listMyDevices(ctx)).toEqual([])
  })

  it('refuses another site (403) and stores nothing', async () => {
    const ctx = ctxFor(db, await makeUser(db))
    current = ctx
    expect((await post(subscription('d'), 'https://evil.example')).status).toBe(403)
    expect((await post(subscription('d'), null)).status).toBe(403)
    expect(await listMyDevices(ctx)).toEqual([])
  })
})
