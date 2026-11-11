import { eq } from 'drizzle-orm'
import type { Ctx } from '@/server/core/context'
import { account } from '@/server/db/schema'

/**
 * How the signed-in user can sign in: a password (Better Auth's "credential" account), and Google
 * (`googleAccountId`: that account row's id, which unlinking it takes; null when not connected).
 */
export type SignInMethods = { password: boolean; googleAccountId: string | null }

export async function listSignInMethods(ctx: Ctx): Promise<SignInMethods> {
  const rows = await ctx.db
    .select({ id: account.id, providerId: account.providerId })
    .from(account)
    .where(eq(account.userId, ctx.user.id))
  return {
    password: rows.some((r) => r.providerId === 'credential'),
    googleAccountId: rows.find((r) => r.providerId === 'google')?.id ?? null,
  }
}
