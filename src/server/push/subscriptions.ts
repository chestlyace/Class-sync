import { and, desc, eq, ne, notInArray } from 'drizzle-orm'
import { z } from 'zod'
import type { Ctx } from '@/server/core/context'
import { AppError } from '@/server/core/errors'
import { pushSubscription } from '@/server/db/schema'

// A device (browser) that agreed to receive push notifications for the signed-in user.

export type SubscriptionInput = { endpoint: string; keys: { p256dh: string; auth: string }; userAgent?: string }
export type MyDevice = { id: string; label: string; createdAt: Date }

const base64url = z
  .string()
  .max(256)
  .regex(/^[A-Za-z0-9_-]+={0,2}$/)
const endpointField = z
  .string()
  .max(2048)
  .refine((v) => {
    try {
      return new URL(v).protocol === 'https:'
    } catch {
      return false
    }
  }, 'Endpoint must be an https URL')

/** At most this many devices per account: a new one past it replaces the oldest. */
export const MAX_DEVICES_PER_USER = 10

/**
 * The browsers' push services. The server posts to whatever endpoint is stored, so anything else
 * (an internal address, an arbitrary site) is refused.
 */
export function isPushServiceHost(hostname: string): boolean {
  const host = hostname.toLowerCase()
  return (
    host === 'fcm.googleapis.com' ||
    host === 'updates.push.services.mozilla.com' ||
    host === 'web.push.apple.com' ||
    host.endsWith('.push.apple.com') ||
    host.endsWith('.notify.windows.com')
  )
}

const pushEndpointField = endpointField.refine((v) => {
  try {
    return isPushServiceHost(new URL(v).hostname)
  } catch {
    return false
  }
}, 'Endpoint must be a known push service')

const subscriptionSchema = z.object({
  endpoint: pushEndpointField,
  keys: z.object({ p256dh: base64url, auth: base64url }),
  userAgent: z.string().max(1024).optional(),
})

function parse<T>(schema: z.ZodType<T>, input: unknown): T {
  const result = schema.safeParse(input)
  if (!result.success) {
    const fields = [...new Set(result.error.issues.map((i) => i.path.join('.')))]
    throw new AppError('VALIDATION', 'Invalid input', { fields })
  }
  return result.data
}

/** "Browser on OS" from a fixed set of names, so no raw user-agent text is stored or shown. */
export function deviceLabel(userAgent: string | undefined): string {
  const ua = userAgent ?? ''
  const browser = /Edg(e|A|iOS)?\//.test(ua)
    ? 'Edge'
    : /SamsungBrowser\//.test(ua)
      ? 'Samsung Internet'
      : /Firefox\/|FxiOS\//.test(ua)
        ? 'Firefox'
        : /Chrome\/|CriOS\//.test(ua)
          ? 'Chrome'
          : /Safari\//.test(ua)
            ? 'Safari'
            : null
  const os = /iPhone/.test(ua)
    ? 'iPhone'
    : /iPad/.test(ua)
      ? 'iPad'
      : /Android/.test(ua)
        ? 'Android'
        : /Windows/.test(ua)
          ? 'Windows'
          : /Mac OS X|Macintosh/.test(ua)
            ? 'macOS'
            : /Linux|X11/.test(ua)
              ? 'Linux'
              : null
  if (!browser) return 'Browser'
  return os ? `${browser} on ${os}` : browser
}

/**
 * Registers or refreshes this device for the caller. The endpoint is unique: a re-subscribe updates
 * the row. Past MAX_DEVICES_PER_USER, the caller's oldest other devices are removed.
 */
export async function subscribe(ctx: Ctx, input: unknown): Promise<{ id: string }> {
  const data = parse(subscriptionSchema, input)
  const values = {
    userId: ctx.user.id,
    p256dh: data.keys.p256dh,
    auth: data.keys.auth,
    label: deviceLabel(data.userAgent),
    failureCount: 0,
  }
  const [row] = await ctx.db
    .insert(pushSubscription)
    .values({ endpoint: data.endpoint, ...values })
    .onConflictDoUpdate({ target: pushSubscription.endpoint, set: values })
    .returning({ id: pushSubscription.id })
  // Keep this device and the caller's newest others, up to the cap.
  const newestOthers = ctx.db
    .select({ id: pushSubscription.id })
    .from(pushSubscription)
    .where(and(eq(pushSubscription.userId, ctx.user.id), ne(pushSubscription.id, row.id)))
    .orderBy(desc(pushSubscription.createdAt), desc(pushSubscription.id))
    .limit(MAX_DEVICES_PER_USER - 1)
  await ctx.db
    .delete(pushSubscription)
    .where(
      and(
        eq(pushSubscription.userId, ctx.user.id),
        ne(pushSubscription.id, row.id),
        notInArray(pushSubscription.id, newestOthers),
      ),
    )
  return { id: row.id }
}

/** Removes the caller's own subscription for this endpoint; anyone else's is left alone. */
export async function unsubscribe(ctx: Ctx, endpoint: unknown): Promise<void> {
  const value = parse(endpointField, endpoint)
  await ctx.db
    .delete(pushSubscription)
    .where(and(eq(pushSubscription.endpoint, value), eq(pushSubscription.userId, ctx.user.id)))
}

/**
 * Whether this browser's endpoint is stored for the caller. False when it is someone else's, was
 * removed in Settings, or was deleted after the push service reported it gone: the browser still
 * holds a subscription, but nothing reaches this account through it.
 */
export async function isMyDevice(ctx: Ctx, endpoint: unknown): Promise<boolean> {
  const value = parse(endpointField, endpoint)
  const [row] = await ctx.db
    .select({ id: pushSubscription.id })
    .from(pushSubscription)
    .where(and(eq(pushSubscription.endpoint, value), eq(pushSubscription.userId, ctx.user.id)))
    .limit(1)
  return row !== undefined
}

export async function listMyDevices(ctx: Ctx): Promise<MyDevice[]> {
  return ctx.db
    .select({ id: pushSubscription.id, label: pushSubscription.label, createdAt: pushSubscription.createdAt })
    .from(pushSubscription)
    .where(eq(pushSubscription.userId, ctx.user.id))
    .orderBy(desc(pushSubscription.createdAt))
}

/** Removes one of the caller's devices. Someone else's (or no such) device: FORBIDDEN. */
export async function removeDevice(ctx: Ctx, id: string): Promise<void> {
  const deleted = await ctx.db
    .delete(pushSubscription)
    .where(and(eq(pushSubscription.id, String(id)), eq(pushSubscription.userId, ctx.user.id)))
    .returning({ id: pushSubscription.id })
  if (deleted.length === 0) throw new AppError('FORBIDDEN', 'Device not found or not yours')
}
