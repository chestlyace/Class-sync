import { and, desc, eq } from 'drizzle-orm'
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

const subscriptionSchema = z.object({
  endpoint: endpointField,
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

/** Registers or refreshes this device for the caller. The endpoint is unique: a re-subscribe updates the row. */
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
  return { id: row.id }
}

/** Removes the caller's own subscription for this endpoint; anyone else's is left alone. */
export async function unsubscribe(ctx: Ctx, endpoint: unknown): Promise<void> {
  const value = parse(endpointField, endpoint)
  await ctx.db
    .delete(pushSubscription)
    .where(and(eq(pushSubscription.endpoint, value), eq(pushSubscription.userId, ctx.user.id)))
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
