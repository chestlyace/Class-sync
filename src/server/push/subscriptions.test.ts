import { eq } from 'drizzle-orm'
import { afterEach, beforeAll, describe, expect, it } from 'vitest'
import type { Db } from '@/server/db'
import { pushSubscription } from '@/server/db/schema'
import { createTestDb } from '@/test/db'
import { ctxFor, makeUser } from '@/test/factories'
import {
  deviceLabel,
  isMyDevice,
  isPushServiceHost,
  listMyDevices,
  MAX_DEVICES_PER_USER,
  removeDevice,
  subscribe,
  unsubscribe,
} from './subscriptions'

const CHROME_ANDROID =
  'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36'
const SAFARI_IPHONE =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1'

const sub = (endpoint = 'https://fcm.googleapis.com/fcm/send/abc', extra: Record<string, unknown> = {}) => ({
  endpoint,
  keys: { p256dh: 'BPublicKey_abc-123', auth: 'authSecret_-9' },
  ...extra,
})

describe('push subscriptions service', () => {
  let db: Db
  beforeAll(async () => {
    db = await createTestDb()
  })
  afterEach(async () => {
    await db.delete(pushSubscription)
  })

  const someone = async () => ctxFor(db, await makeUser(db, { role: 'lecturer' }))

  it('subscribes a device and lists it', async () => {
    const ctx = await someone()
    const { id } = await subscribe(ctx, sub(undefined, { userAgent: CHROME_ANDROID }))
    const devices = await listMyDevices(ctx)
    expect(devices).toHaveLength(1)
    expect(devices[0]).toMatchObject({ id, label: 'Chrome on Android' })
    expect(devices[0].createdAt).toBeInstanceOf(Date)
  })

  it('rejects an http endpoint', async () => {
    const ctx = await someone()
    await expect(subscribe(ctx, sub('http://fcm.googleapis.com/fcm/send/x'))).rejects.toMatchObject({ code: 'VALIDATION' })
  })

  it('updates keys when the same device subscribes again', async () => {
    const ctx = await someone()
    await subscribe(ctx, sub())
    await db.update(pushSubscription).set({ failureCount: 3 })
    await subscribe(ctx, { ...sub(), keys: { p256dh: 'newKey', auth: 'newAuth' } })
    const rows = await db.select().from(pushSubscription)
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ p256dh: 'newKey', auth: 'newAuth', failureCount: 0 })
  })

  it('moves an endpoint to the new user', async () => {
    const a = await someone()
    const b = await someone()
    await subscribe(a, sub())
    await subscribe(b, sub())
    expect(await listMyDevices(a)).toHaveLength(0)
    expect(await listMyDevices(b)).toHaveLength(1)
  })

  it("unsubscribe ignores another user's endpoint", async () => {
    const a = await someone()
    const b = await someone()
    await subscribe(a, sub())
    await unsubscribe(b, sub().endpoint)
    expect(await listMyDevices(a)).toHaveLength(1)
    await unsubscribe(a, sub().endpoint)
    expect(await listMyDevices(a)).toHaveLength(0)
  })

  it("removeDevice forbids another user's device", async () => {
    const a = await someone()
    const b = await someone()
    const { id } = await subscribe(a, sub())
    await expect(removeDevice(b, id)).rejects.toMatchObject({ code: 'FORBIDDEN' })
    await removeDevice(a, id)
    expect(await db.select().from(pushSubscription).where(eq(pushSubscription.id, id))).toHaveLength(0)
  })

  it('accepts the browsers’ push services only', async () => {
    const ctx = await someone()
    for (const endpoint of [
      'https://fcm.googleapis.com/fcm/send/x1',
      'https://updates.push.services.mozilla.com/wpush/v2/x2',
      'https://web.push.apple.com/x3',
      'https://api.push.apple.com/x4',
      'https://wns2-par02p.notify.windows.com/w/?token=x5',
    ]) {
      await expect(subscribe(ctx, sub(endpoint))).resolves.toMatchObject({ id: expect.any(String) })
    }
    for (const endpoint of [
      'https://push.example.com/x',
      'https://169.254.169.254/latest/meta-data',
      'https://localhost/x',
      'https://fcm.googleapis.com.evil.example/x',
      'https://evilpush.apple.com/x',
      'https://notify.windows.com.evil.example/x',
    ]) {
      await expect(subscribe(ctx, sub(endpoint))).rejects.toMatchObject({ code: 'VALIDATION' })
    }
    expect(isPushServiceHost('FCM.googleapis.com')).toBe(true)
    expect(isPushServiceHost('push.apple.com')).toBe(false)
  })

  it(`keeps at most ${MAX_DEVICES_PER_USER} devices per user, dropping the oldest`, async () => {
    const ctx = await someone()
    const other = await someone()
    await subscribe(other, sub('https://fcm.googleapis.com/fcm/send/other'))
    for (let i = 0; i < MAX_DEVICES_PER_USER; i++) {
      await subscribe(ctx, sub(`https://fcm.googleapis.com/fcm/send/d${i}`))
      // Distinct ages: d0 is the oldest.
      await db
        .update(pushSubscription)
        .set({ createdAt: new Date(Date.UTC(2026, 0, 1 + i)) })
        .where(eq(pushSubscription.endpoint, `https://fcm.googleapis.com/fcm/send/d${i}`))
    }
    expect(await listMyDevices(ctx)).toHaveLength(MAX_DEVICES_PER_USER)

    // Re-subscribing an existing device (even the oldest) removes nothing.
    await subscribe(ctx, sub('https://fcm.googleapis.com/fcm/send/d0'))
    expect(await listMyDevices(ctx)).toHaveLength(MAX_DEVICES_PER_USER)

    await subscribe(ctx, sub('https://fcm.googleapis.com/fcm/send/new'))
    const endpoints = (await db.select().from(pushSubscription).where(eq(pushSubscription.userId, ctx.user.id))).map(
      (r) => r.endpoint,
    )
    expect(endpoints).toHaveLength(MAX_DEVICES_PER_USER)
    expect(endpoints).toContain('https://fcm.googleapis.com/fcm/send/new')
    expect(endpoints).not.toContain('https://fcm.googleapis.com/fcm/send/d0')
    expect(endpoints).toContain('https://fcm.googleapis.com/fcm/send/d1')
    // Someone else's device is never touched.
    expect(await listMyDevices(other)).toHaveLength(1)
  })

  it('isMyDevice is true only for the caller’s own stored endpoint', async () => {
    const a = await someone()
    const b = await someone()
    const endpoint = sub().endpoint
    expect(await isMyDevice(a, endpoint)).toBe(false)
    const { id } = await subscribe(a, sub())
    expect(await isMyDevice(a, endpoint)).toBe(true)
    expect(await isMyDevice(b, endpoint)).toBe(false)
    // Removed in Settings (or deleted after the push service said gone): no longer this user's.
    await removeDevice(a, id)
    expect(await isMyDevice(a, endpoint)).toBe(false)
    await expect(isMyDevice(a, 'not a url')).rejects.toMatchObject({ code: 'VALIDATION' })
  })

  it('labels Chrome on Android and Safari on iPhone', () => {
    expect(deviceLabel(CHROME_ANDROID)).toBe('Chrome on Android')
    expect(deviceLabel(SAFARI_IPHONE)).toBe('Safari on iPhone')
    expect(deviceLabel(undefined)).toBe('Browser')
  })
})
