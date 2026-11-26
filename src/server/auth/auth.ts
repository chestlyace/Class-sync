import { apiKey } from '@better-auth/api-key'
import { cimd } from '@better-auth/cimd'
import { fetchClientMetadataResource } from '@better-auth/cimd/node'
import { mcp } from '@better-auth/mcp'
import { betterAuth, type GenericEndpointContext } from 'better-auth'
import { and, eq, gte, inArray, like, ne } from 'drizzle-orm'
import { drizzleAdapter } from 'better-auth/adapters/drizzle'
import { APIError, createAuthMiddleware, getOAuthState, getSessionFromCtx } from 'better-auth/api'
import { nextCookies } from 'better-auth/next-js'
import { jwt, phoneNumber } from 'better-auth/plugins'
import { waitUntil } from '@vercel/functions'
import { CLIENT_IP_HEADER, forwardedClientIp } from '@/lib/client-ip'
import { isLocale, LOCALE_COOKIE, resolveLocale } from '@/i18n/locale'
import { supportEmail } from '@/lib/contact'
import { safeNextPath } from '@/lib/next-path'
import { RESET_RESEND_SECONDS } from '@/lib/password-reset'
import { toE164 } from '@/lib/phone'
import { now } from '@/server/core/clock'
import { config } from '@/server/core/config'
import { AppError } from '@/server/core/errors'
import { isVerificationPending } from '@/server/core/guards'
import { db, type Db } from '@/server/db'
import * as schema from '@/server/db/schema'
import { sendEmail } from '@/server/email/send'
import { PasswordChangedWhatsAppEmail } from '@/server/email/templates/password-changed-whatsapp'
import { ResetPasswordEmail } from '@/server/email/templates/reset-password'
import { emailSubject, VerifyEmail } from '@/server/email/templates/verify-email'
import { isAllowedWhatsAppNumber, whatsAppVerificationEnabled } from '@/server/whatsapp/config'
import { googleCredentials, signupFieldsFromOAuthState } from './google'
import { checkCodeLimits, CodeLimitedError, hitCodeLimits, hitIpLimit, sendVerificationCode } from './phone-otp'
import { isPhoneReset } from './phone-reset-scope'
import { assertValidSignup, assertValidUserUpdate, cleanName } from './signup-rules'

type CreateAuthOptions = {
  baseURL?: string
  secret?: string
  /** Google sign-in credentials; defaults to GOOGLE_CLIENT_ID/SECRET. Null turns Google off. */
  google?: { clientId: string; clientSecret: string } | null
  /** Disable in tests: the plugin needs Next's request scope to set cookies. */
  nextCookies?: boolean
  /** Tests only: Better Auth rate-limits in production only unless this is set. */
  rateLimitEnabled?: boolean
}

/**
 * A whole class signs in at once, often from one school network or a carrier's CGNAT (one public
 * IP), so Better Auth's default of 3 per 10 s per IP would lock students out. Sign-in allows 100
 * per minute per IP: at the start of a test ~50 students may sign in together, and a refused
 * student loses time on the clock. That still slows down password guessing. Sign-up keeps 30 per
 * minute (a class signs up once, not under a running clock). Memory storage: per instance.
 */
const SIGN_IN_RULE = { window: 60, max: 100 }
const SIGN_UP_RULE = { window: 60, max: 30 }
// A class shares one public IP, so this limit must be as generous as sign-in's; flooding a single
// inbox is stopped by the per-address cooldown below instead.
const RESET_REQUEST_RULE = { window: 60, max: 100 }
const RESET_COOLDOWN_MS = RESET_RESEND_SECONDS * 1000
// WhatsApp codes: 6 digits, valid 10 minutes, 3 wrong tries per code.
const PHONE_CODE_TTL_SECONDS = 10 * 60
const PHONE_CODE_ATTEMPTS = 3
const VERIFY_LINK_TTL_SECONDS = 7 * 24 * 60 * 60
// Students read mail days later and may be on a patchy connection; a day is still short enough
// that a stolen link has little time to be used.
const RESET_LINK_TTL_SECONDS = 24 * 60 * 60


const PHONE_CODE_LIMITED_MESSAGE = 'Too many codes requested. Please wait before asking for another.'
const SEND_OTP_PATH = '/phone-number/send-otp'
const RESET_OTP_PATH = '/phone-number/request-password-reset'
const SIGN_IN_PHONE_PATH = '/sign-in/phone-number'
const LINK_SOCIAL_PATH = '/link-social'
const UPDATE_USER_PATH = '/update-user'

/**
 * The account that claimed a code in the before hook, for the send callback that runs later in the background
 * (so it never has to look the session up again). Keyed by the request; a server-side call without a request
 * falls back to the session the hook cached on the shared context.
 */
const codeRequesters = new WeakMap<object, string>()

/**
 * Runs before the plugin's two "send me a code" routes. Everything that decides whether Clasync may send a
 * WhatsApp message is here and not in the send callbacks, because the plugin runs those in the background
 * (a throw there never reaches the caller) and only for numbers that have an account.
 *
 * - Off unless WhatsApp codes are enabled (404).
 * - The number is put into E.164 form; the plugin then sees only that form.
 * - `send-otp` needs a session: an anonymous visitor can never make Clasync message anyone. It also refuses
 *   (NUMBER_TAKEN) a number another account has already proven, so nobody can spam a proven holder.
 * - Only a request that can lead to a message spends the number's and the platform's daily budget (claimed with the
 *   account and IP limits in one transaction, `hitCodeLimits`): a `send-otp` for a number outside WHATSAPP_ALLOWLIST is
 *   refused (NUMBER_NOT_ALLOWED), and a reset for a number no account has proven (or outside the allowlist) counts
 *   against the IP only, so anonymous probing cannot use up the day's codes.
 * - A limited `send-otp` fails with PHONE_CODE_LIMITED and `retryAfter`. A limited password-reset request
 *   answers exactly like a normal one (`{ status: true }`), so the answer never says whether the number has an
 *   account, and it never reaches the plugin: no new code is stored, so a code sent a moment ago stays valid.
 */
async function guardCodeRequest(
  database: Db,
  ctx: Parameters<Parameters<typeof createAuthMiddleware>[0]>[0],
): Promise<{ context: { body: { phoneNumber: string } } } | { status: true } | undefined> {
  if (!whatsAppVerificationEnabled()) {
    throw new APIError('NOT_FOUND', { message: 'Verification by WhatsApp is not available', code: 'WHATSAPP_CODES_OFF' })
  }
  const raw = (ctx.body as { phoneNumber?: unknown } | undefined)?.phoneNumber
  // Not a string: leave it to the route's own validation, which refuses it before anything is sent.
  if (typeof raw !== 'string') return undefined
  const phone = toE164(raw)
  if (!phone) throw new APIError('BAD_REQUEST', { message: 'Invalid phone number', code: 'INVALID_PHONE_NUMBER' })

  const isReset = ctx.path === RESET_OTP_PATH
  const headers = ctx.request?.headers ?? ctx.headers
  const ip = headers ? (headers.get(CLIENT_IP_HEADER) ?? forwardedClientIp(headers)) : null
  let userId: string | null = null
  if (isReset) {
    const [holder] = await database
      .select({ id: schema.user.id })
      .from(schema.user)
      .where(and(eq(schema.user.phoneNumber, phone), eq(schema.user.phoneNumberVerified, true)))
    if (!holder || !isAllowedWhatsAppNumber(phone)) {
      // Nothing can be sent: same answer as always, no budget spent, the IP still counted.
      await hitIpLimit(database, ip)
      return { status: true }
    }
  } else {
    const session = await getSessionFromCtx(ctx)
    if (!session) throw new APIError('UNAUTHORIZED', { message: 'Sign in first', code: 'UNAUTHORIZED' })
    userId = session.user.id
    const [holder] = await database
      .select({ id: schema.user.id })
      .from(schema.user)
      .where(and(eq(schema.user.phoneNumber, phone), eq(schema.user.phoneNumberVerified, true), ne(schema.user.id, userId)))
    if (holder) throw new APIError('BAD_REQUEST', { message: 'This number is already used by another account', code: 'NUMBER_TAKEN' })
    // Nothing would be sent to it: say so instead of pretending, and spend nothing.
    if (!isAllowedWhatsAppNumber(phone)) {
      throw new APIError('BAD_REQUEST', { message: 'WhatsApp codes are not available for this number yet', code: 'NUMBER_NOT_ALLOWED' })
    }
  }
  const input = { phone, userId, ip, purpose: isReset ? ('reset' as const) : ('verify' as const) }

  const verdict = await checkCodeLimits(database, input)
  let limited = verdict.ok ? null : verdict
  if (!limited) {
    try {
      await hitCodeLimits(database, input)
    } catch (error) {
      if (!(error instanceof CodeLimitedError)) throw error
      limited = { ok: false, reason: error.reason, retryAfter: error.retryAfter }
    }
  }
  if (limited) {
    if (isReset) return { status: true }
    throw new APIError(
      'TOO_MANY_REQUESTS',
      { message: PHONE_CODE_LIMITED_MESSAGE, code: 'PHONE_CODE_LIMITED', retryAfter: limited.retryAfter },
      { 'Retry-After': String(limited.retryAfter) },
    )
  }
  if (userId && ctx.request) codeRequesters.set(ctx.request, userId)
  return { context: { body: { phoneNumber: phone } } }
}

/**
 * Runs before the plugin's phone sign-in. The plugin answers "not verified" (and stores a fresh code, replacing
 * one the number's owner may be about to use) for any caller who knows an unproven number, whatever password they
 * send. So only a number an account has proven reaches it; anything else gets the same 401 as a wrong password.
 */
async function guardPhoneSignIn(
  database: Db,
  ctx: Parameters<Parameters<typeof createAuthMiddleware>[0]>[0],
): Promise<{ context: { body: Record<string, unknown> } } | undefined> {
  const body = ctx.body as Record<string, unknown> | undefined
  const raw = body?.phoneNumber
  // Not a string: the route's own validation refuses it.
  if (!body || typeof raw !== 'string') return undefined
  const phone = toE164(raw)
  // Not a valid number: the plugin's validator refuses it with INVALID_PHONE_NUMBER, which says nothing about accounts.
  if (!phone) return undefined
  const [holder] = await database
    .select({ id: schema.user.id })
    .from(schema.user)
    .where(and(eq(schema.user.phoneNumber, phone), eq(schema.user.phoneNumberVerified, true)))
  if (!holder) {
    throw new APIError('UNAUTHORIZED', { message: 'Invalid phone number or password', code: 'INVALID_PHONE_NUMBER_OR_PASSWORD' })
  }
  return { context: { body: { ...body, phoneNumber: phone } } }
}

/**
 * Runs before `/link-social` (connecting Google from Settings, which may use a Google account with another
 * address). Refused while the account's email is not verified: an unverified account may have been
 * registered by someone else under the owner's address, and a login they linked would outlast the owner's
 * recovery of the account. Read from the database, not the session's copy. No session: the route refuses.
 */
async function guardLinkSocial(database: Db, ctx: Parameters<Parameters<typeof createAuthMiddleware>[0]>[0]): Promise<void> {
  const session = await getSessionFromCtx(ctx)
  if (!session) return
  const [row] = await database.select({ emailVerified: schema.user.emailVerified }).from(schema.user).where(eq(schema.user.id, session.user.id))
  if (!row?.emailVerified) {
    throw new APIError('FORBIDDEN', { message: 'Confirm your email address before connecting Google', code: 'EMAIL_NOT_VERIFIED_FOR_LINK' })
  }
}

/**
 * Runs before `/update-user`. The sign-in number changes only through a WhatsApp code (or a JOIN message),
 * and is removed only through Settings, which refuses while it is the account's only proof. The plugin
 * itself refuses a new number here but lets `phoneNumber: null` through, so both fields are refused outright.
 */
function guardUserUpdate(ctx: Parameters<Parameters<typeof createAuthMiddleware>[0]>[0]): void {
  const body = ctx.body as Record<string, unknown> | undefined
  if (body && typeof body === 'object' && ('phoneNumber' in body || 'phoneNumberVerified' in body)) {
    throw new APIError('BAD_REQUEST', { message: 'The WhatsApp number cannot be changed here', code: 'PHONE_NUMBER_CANNOT_BE_UPDATED' })
  }
}

/**
 * The plugin's send callback for sign-up verification and password reset. Language: for a code a signed-in
 * account asked for (sign-up, Settings), that account's; for a reset, the account that has proven the number;
 * else the visitor's language cookie, else English.
 */
async function deliverPhoneCode(database: Db, data: { phoneNumber: string; code: string }, ctx?: GenericEndpointContext): Promise<void> {
  // Signing in with a number that is not proven yet must stay silent: it is not a request for a code.
  if (ctx?.path === SIGN_IN_PHONE_PATH) return
  // The account that asked, as the before hook claimed the limits for it (never looked up again here).
  const userId =
    ctx?.path === SEND_OTP_PATH
      ? ((ctx.request && codeRequesters.get(ctx.request)) ?? (ctx.context.session as { user?: { id?: string } } | null)?.user?.id ?? null)
      : null
  const [owner] = await database
    .select({ locale: schema.user.locale })
    .from(schema.user)
    .where(
      userId
        ? eq(schema.user.id, userId)
        : and(eq(schema.user.phoneNumber, data.phoneNumber), eq(schema.user.phoneNumberVerified, true)),
    )
  const locale = resolveLocale({ userLocale: owner?.locale, cookie: ctx?.getCookie(LOCALE_COOKIE) })
  await sendVerificationCode(database, { phone: data.phoneNumber, code: data.code, locale, userId })
}

/** The OAuth provider's client CRUD routes, closed over HTTP (see `disabledPaths`). */
export const OAUTH_CLIENT_MANAGEMENT_PATHS = [
  '/oauth2/create-client',
  '/oauth2/update-client',
  '/oauth2/delete-client',
  '/oauth2/get-client',
  '/oauth2/get-clients',
  '/oauth2/client/rotate-secret',
]

/** The phone plugin's routes that check a code, closed over HTTP (see `disabledPaths`). */
export const PHONE_CODE_CHECK_PATHS = ['/phone-number/verify', '/phone-number/reset-password']

/** Scopes an assistant can be granted. Read tools need `clasync:read`, draft tools `clasync:write`. */
export const MCP_OAUTH_SCOPES = ['openid', 'profile', 'email', 'offline_access', 'clasync:read', 'clasync:write']

/** Personal access tokens: `cls_` + 64 characters, sent as `Authorization: Bearer cls_…`. */
export const API_KEY_PREFIX = 'cls_'

/**
 * The app's public origin: the explicit option, else BETTER_AUTH_URL, else the Vercel deployment
 * URL, else localhost:3000. The OAuth provider needs a fixed base URL (issuer and MCP resource
 * derive from it), so production needs BETTER_AUTH_URL set to the stable URL, and local runs on
 * another port need it too.
 */
export function resolveAppOrigin(explicit?: string): string {
  const vercel = process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : undefined
  const raw = explicit || process.env.BETTER_AUTH_URL || vercel || 'http://localhost:3000'
  return new URL(raw).origin
}

/** The MCP endpoint: the resource access tokens are bound to (`aud`). */
export function mcpResourceUrl(origin: string): string {
  return `${origin}/api/mcp`
}

function toApiError(err: unknown): unknown {
  if (!(err instanceof AppError)) return err
  // A refused name gets its own code, so the form can say what is wrong with it.
  const fields = (err.details as { fields?: unknown } | undefined)?.fields
  const code = Array.isArray(fields) && fields.includes('name') ? 'INVALID_NAME' : err.code
  return new APIError('BAD_REQUEST', { message: err.message, code })
}

/**
 * Better Auth has just created the current request's `reset-password:<token>` row. If the same
 * account was given another link inside the cooldown, its inbox has enough already: skip the send
 * while still answering the normal generic success (and leaving the new link usable).
 */
async function resetRequestedRecently(database: Db, userId: string, token: string): Promise<boolean> {
  const since = new Date(now().getTime() - RESET_COOLDOWN_MS)
  const rows = await database
    .select({ identifier: schema.verification.identifier })
    .from(schema.verification)
    .where(
      and(
        eq(schema.verification.value, userId),
        like(schema.verification.identifier, 'reset-password:%'),
        ne(schema.verification.identifier, `reset-password:${token}`),
        gte(schema.verification.createdAt, since),
      ),
    )
    .limit(1)
  return rows.length > 0
}

/**
 * Deletes a reset link nobody was emailed (skipped by the cooldown, or the send failed). Only links
 * that went out then count toward the cooldown, so asking again after a failed send gets a link.
 */
async function withdrawResetLink(database: Db, token: string): Promise<void> {
  await database.delete(schema.verification).where(eq(schema.verification.identifier, `reset-password:${token}`))
}

/**
 * The emailed reset link was opened for an account whose email was not verified yet: this proves the
 * address, and whoever registered the account with it before (a squatter, say) may have added their own
 * ways back in from the limited session an unverified account gets. In one transaction, everything that
 * is not the password goes: Google and any other linked login (the `credential` row, just reset, stays),
 * the WhatsApp sign-in number with its pending codes, the alert link and unused JOIN codes, personal access
 * tokens, assistant (OAuth) tokens and consents, and push subscriptions. Then the email is marked verified.
 * Sessions were already ended by the reset (`revokeSessionsOnPasswordReset`). The real owner can add any of
 * these again from Settings. Never run for a WhatsApp reset, nor when the email was already verified.
 */
async function claimAccountByEmailReset(database: Db, user: { id: string; phoneNumber?: string | null }): Promise<void> {
  // Read from the database, not the callback's copy: the number to clear codes for is the stored one.
  await database.transaction(async (tx) => {
    const [row] = await tx
      .select({ phoneNumber: schema.user.phoneNumber })
      .from(schema.user)
      .where(eq(schema.user.id, user.id))
      .for('update')
    const phones = [...new Set([row?.phoneNumber, user.phoneNumber].filter((p): p is string => typeof p === 'string' && p !== ''))]
    await tx.delete(schema.account).where(and(eq(schema.account.userId, user.id), ne(schema.account.providerId, 'credential')))
    await tx.delete(schema.whatsappLink).where(eq(schema.whatsappLink.userId, user.id))
    await tx.delete(schema.whatsappConnectCode).where(eq(schema.whatsappConnectCode.userId, user.id))
    await tx.delete(schema.apikey).where(eq(schema.apikey.referenceId, user.id))
    await tx.delete(schema.oauthAccessToken).where(eq(schema.oauthAccessToken.userId, user.id))
    await tx.delete(schema.oauthRefreshToken).where(eq(schema.oauthRefreshToken.userId, user.id))
    await tx.delete(schema.oauthConsent).where(eq(schema.oauthConsent.userId, user.id))
    await tx.delete(schema.pushSubscription).where(eq(schema.pushSubscription.userId, user.id))
    if (phones.length > 0) {
      const identifiers = phones.flatMap((p) => [`phone-number-otp-${p}`, `phone-number-reset-${p}`])
      await tx.delete(schema.verification).where(inArray(schema.verification.identifier, identifiers))
    }
    await tx
      .update(schema.user)
      .set({ phoneNumber: null, phoneNumberVerified: false, emailVerified: true, updatedAt: now() })
      .where(eq(schema.user.id, user.id))
  })
}

export function createAuth(database: Db, options: CreateAuthOptions = {}) {
  const origin = resolveAppOrigin(options.baseURL)
  const google = options.google === undefined ? googleCredentials() : options.google

  /**
   * "Your password was changed using WhatsApp (number ending 47)": goes to the account's email, and only
   * when that email is verified (an unverified address may belong to someone else). A failed send is logged
   * and never undoes the reset, which has already happened.
   */
  async function sendPasswordChangedNotice(user: { email: string; emailVerified?: boolean | null; phoneNumber?: string | null }) {
    if (!user.emailVerified) return
    try {
      // additionalFields are not reflected in this callback's user type.
      const rawLocale = (user as { locale?: unknown }).locale
      const locale = isLocale(rawLocale) ? rawLocale : 'en'
      await sendEmail({
        to: user.email,
        subject: emailSubject('passwordChangedWhatsApp', locale),
        kind: 'passwordChangedWhatsApp',
        react: PasswordChangedWhatsAppEmail({
          lastDigits: (user.phoneNumber ?? '').replace(/\D/g, '').slice(-2),
          url: `${origin}/forgot-password`,
          support: supportEmail(),
          locale,
        }),
      })
    } catch (error) {
      console.error('[auth] password changed notice failed', error)
    }
  }

  return betterAuth({
    baseURL: origin,
    ...(options.secret ? { secret: options.secret } : {}),
    // The jwt plugin's /token would hand out session JWTs; MCP uses OAuth access tokens only.
    // Personal access tokens are managed through src/server/mcp/connections.ts (lecturers only,
    // at most 10, named, fixed expiries), so the api-key plugin's HTTP routes stay closed;
    // `auth.api` calls are not affected.
    // The OAuth provider's client-management routes are closed too: assistants register through
    // dynamic registration or a metadata document, and nobody (students included) manages clients
    // over HTTP. The consent page reads clients through src/server/mcp/connections.ts.
    // The phone plugin's code-checking routes are closed as well: Clasync calls them only through
    // `auth.api` (phone-verification.ts, reset-password-phone.ts), which add the rules the bare routes
    // lack (no passwordless sign-in from a code, one "wrong code" answer whether or not a number has an account).
    disabledPaths: [
      '/token',
      '/api-key/create',
      '/api-key/update',
      '/api-key/delete',
      '/api-key/list',
      '/api-key/get',
      ...OAUTH_CLIENT_MANAGEMENT_PATHS,
      ...PHONE_CODE_CHECK_PATHS,
    ],
    advanced: {
      // Sending mail must not hold the response open: otherwise a real address takes measurably
      // longer than an unknown one (which Better Auth answers without sending) and leaks accounts.
      // waitUntil keeps the send alive after the response on Vercel; elsewhere it is a no-op and
      // the promise still runs. Better Auth logs any rejection the handler's promise produces.
      backgroundTasks: { handler: waitUntil },
      // Set by src/proxy.ts for the platform (Heroku's router keeps a client's own x-forwarded-for in
      // front); x-forwarded-for alone is the fallback where the proxy did not run.
      ipAddress: { ipAddressHeaders: [CLIENT_IP_HEADER, 'x-forwarded-for'] },
    },
    hooks: {
      // Phone-code requests are guarded here; only a verified lecturer can allow an assistant (denying stays open to everyone).
      before: createAuthMiddleware(async (ctx) => {
        if (ctx.path === SEND_OTP_PATH || ctx.path === RESET_OTP_PATH) return guardCodeRequest(database, ctx)
        if (ctx.path === SIGN_IN_PHONE_PATH) return guardPhoneSignIn(database, ctx)
        if (ctx.path === LINK_SOCIAL_PATH) return guardLinkSocial(database, ctx)
        if (ctx.path === UPDATE_USER_PATH) return guardUserUpdate(ctx)
        if (ctx.path !== '/oauth2/consent' || (ctx.body as { accept?: unknown } | undefined)?.accept !== true) return
        const session = await getSessionFromCtx(ctx)
        const u = session?.user as { role?: unknown; emailVerified?: boolean; phoneNumberVerified?: boolean } | undefined
        if (
          !u ||
          u.role !== 'lecturer' ||
          isVerificationPending({ emailVerified: u.emailVerified === true, phoneNumberVerified: u.phoneNumberVerified === true })
        ) {
          throw new APIError('FORBIDDEN', { message: "Clasync's assistant connection is for lecturers", code: 'LECTURERS_ONLY' })
        }
      }),
    },
    database: drizzleAdapter(database, { provider: 'pg', schema }),
    emailAndPassword: {
      enabled: true,
      // An unverified account may sign in: it gets a limited session (the verify banner, and
      // `requireVerified` keeps it from creating or joining anything) that the sign-in and
      // sign-up pages use to attach a WhatsApp number or send a verification email. Whether an
      // account counts as verified is `isAccountVerified`, not Better Auth's own gate.
      requireEmailVerification: false,
      // No session at sign-up: the person proves an email or a WhatsApp number first. This also
      // makes a sign-up with an address already in use answer exactly like a new one (no leak).
      // With verification switched off (local development) the account opens straight away.
      autoSignIn: !config.requireEmailVerification,
      resetPasswordTokenExpiresIn: RESET_LINK_TTL_SECONDS,
      // A changed password must end every session, including one an attacker may already hold.
      revokeSessionsOnPasswordReset: true,
      sendResetPassword: async ({ user, token, url }) => {
        // additionalFields are not reflected in this callback's user type.
        const rawLocale = (user as { locale?: unknown }).locale
        const locale = isLocale(rawLocale) ? rawLocale : 'en'
        // Better Auth puts the requested destination (if any) on its own callback URL; our page
        // takes the token directly, so carry the validated path on our link instead.
        const next = safeNextPath(new URL(url).searchParams.get('callbackURL'))
        const params = new URLSearchParams({ token })
        if (next) params.set('next', next)
        const link = `${origin}/reset-password?${params.toString()}`
        if (process.env.NODE_ENV !== 'production' && !process.env.RESEND_API_KEY) {
          // Local testing only: lets a developer finish a reset without an email provider.
          console.info('[email] dev password reset link:', link)
        }
        try {
          if (await resetRequestedRecently(database, user.id, token)) {
            console.info('[auth] password reset email skipped: another link was sent recently')
            await withdrawResetLink(database, token)
            return
          }
          await sendEmail({
            to: user.email,
            subject: emailSubject('resetPassword', locale),
            kind: 'resetPassword',
            react: ResetPasswordEmail({ url: link, locale }),
          })
        } catch (error) {
          // A Resend failure (or a missing API key) must not change the public response: that
          // would tell the requester that this address really has an account.
          console.error('[auth] password reset email failed', error)
          await withdrawResetLink(database, token).catch((cleanupError) =>
            console.error('[auth] could not withdraw an unsent reset link', cleanupError),
          )
        }
      },
      // The link reached this inbox, which proves the address: an account that never finished
      // verification (a lost or bounced verification email) can sign in straight away. Safe against
      // someone who registered another person's address: the reset replaced their password and
      // ended their sessions.
      // A reset by WhatsApp code proves the number, not the email: it never marks the email verified.
      // It tells the owner by email instead (when that email is verified), so a reset through a
      // reassigned SIM does not go unnoticed. Here, not in the reset service, so a direct call to the
      // plugin's route cannot skip the notice.
      // An email reset of an account whose email was never verified also takes away every other way in
      // that someone could have added before the owner arrived (`claimAccountByEmailReset`).
      onPasswordReset: async ({ user }, request) => {
        if (isPhoneReset(request)) {
          await sendPasswordChangedNotice(user)
          return
        }
        if (user.emailVerified) return
        await claimAccountByEmailReset(database, user)
      },
    },
    socialProviders: google
      ? {
          google: {
            ...google,
            prompt: 'select_account',
            // Only the sign-up page creates accounts with Google (it sends the chosen role along
            // as `requestSignUp`): from the sign-in page an unknown Google account is sent to
            // sign-up instead of getting an account with no role.
            disableImplicitSignUp: true,
            mapProfileToUser: async () => signupFieldsFromOAuthState(await getOAuthState()),
          },
        }
      : {},
    account: {
      // Google access and refresh tokens (kept for the Meet API) are stored encrypted with the auth secret.
      // Rows written before this option stay readable: Better Auth's `isLikelyEncrypted` check passes a
      // plain token through unchanged, and the next refresh or re-link writes it encrypted.
      encryptOAuthTokens: true,
      accountLinking: {
        // Signing in with Google under the email of an existing account joins that account, but
        // only once its email is verified: otherwise someone could register another person's
        // address with a password and keep access after the owner arrives through Google.
        // Refused attempts come back with `error=account_not_linked` (auth.google.notLinked tells
        // the user to confirm the address first). Google itself is deliberately not a trusted
        // provider: it reports verified emails anyway, and trusting it would not lift this rule.
        requireLocalEmailVerified: true,
        // Linking from Settings (signed in) may use a Google account with another address, e.g. a
        // personal Gmail for an account made with a school email. Only once the account's email is
        // verified (`guardLinkSocial`).
        allowDifferentEmails: true,
      },
    },
    emailVerification: {
      // Students often read mail days later, on patchy data. The link only confirms the address
      // (it does not sign anyone in), so a long life costs little.
      expiresIn: VERIFY_LINK_TTL_SECONDS,
      // Never sent on its own: the person chooses email or WhatsApp at sign-up, and the verify
      // banner (and the admin) ask for a link when one is wanted.
      sendOnSignUp: false,
      sendOnSignIn: false,
      sendVerificationEmail: async ({ user, url }) => {
        // additionalFields are not reflected in this callback's user type.
        const rawLocale = (user as { locale?: unknown }).locale
        const locale = isLocale(rawLocale) ? rawLocale : 'en'
        if (process.env.NODE_ENV !== 'production' && !process.env.RESEND_API_KEY) {
          // Local testing only: lets a developer complete verification without an email provider.
          console.info('[email] dev verification link:', url)
        }
        await sendEmail({
          to: user.email,
          subject: emailSubject('verify', locale),
          kind: 'verify',
          react: VerifyEmail({ url, locale }),
        })
      },
    },
    rateLimit: {
      ...(options.rateLimitEnabled !== undefined ? { enabled: options.rateLimitEnabled } : {}),
      storage: 'memory',
      customRules: {
        '/sign-in/email': SIGN_IN_RULE,
        '/sign-in/social': SIGN_IN_RULE,
        '/sign-up/email': SIGN_UP_RULE,
        '/request-password-reset': RESET_REQUEST_RULE,
        // The phone plugin's own 10 per minute per IP would lock out a class sharing one public IP.
        // Abuse is bounded per code and per number instead (3 tries, 10 minutes).
        '/phone-number/*': SIGN_UP_RULE,
        '/sign-in/phone-number': SIGN_IN_RULE,
      },
    },
    user: {
      additionalFields: {
        role: { type: 'string', required: true, input: true },
        locale: { type: 'string', required: false, defaultValue: 'en', input: true },
      },
    },
    databaseHooks: {
      user: {
        create: {
          before: async (user) => {
            try {
              const { role, locale } = assertValidSignup({
                role: (user as Record<string, unknown>).role,
                locale: (user as Record<string, unknown>).locale,
              })
              return { data: { ...user, name: cleanName(user.name), role, locale } }
            } catch (err) {
              throw toApiError(err)
            }
          },
        },
        update: {
          // `role` and `locale` are `input: true` (needed at sign-up), which also exposes them
          // to /update-user. Roles are chosen at sign-up only; locale must stay valid.
          before: async (data) => {
            try {
              return { data: assertValidUserUpdate(data as Record<string, unknown>) }
            } catch (err) {
              throw toApiError(err)
            }
          },
        },
      },
      session: {
        create: {
          // Every way in (password sign-in, sign-up, email verification, OAuth login) creates a
          // session: a suspended account gets none. Pages and MCP check again on each request.
          before: async (session) => {
            const [row] = await database
              .select({ suspendedAt: schema.user.suspendedAt })
              .from(schema.user)
              .where(eq(schema.user.id, session.userId))
            if (row?.suspendedAt) {
              throw new APIError('FORBIDDEN', { message: 'This account is suspended', code: 'ACCOUNT_SUSPENDED' })
            }
          },
          after: async (session) => {
            await database.update(schema.user).set({ lastSignInAt: now() }).where(eq(schema.user.id, session.userId))
          },
        },
      },
    },
    plugins: [
      // Signs the OAuth access tokens (keys live in the jwks table, created on first use).
      jwt({ disableSettingJwtHeader: true }),
      // OAuth 2.1 provider for AI assistants (Claude, ChatGPT…): tokens bound to /api/mcp.
      mcp({
        loginPage: '/sign-in',
        consentPage: '/oauth/consent',
        resource: mcpResourceUrl(origin),
        scopes: MCP_OAUTH_SCOPES,
        // Hosted assistants register themselves (RFC 7591) without credentials.
        allowDynamicClientRegistration: true,
        allowUnauthenticatedClientRegistration: true,
        // CLI assistants (Claude Code, Cursor) register http://localhost callbacks without sending
        // application_type: classify those as native clients instead of refusing them as web ones.
        clientRegistrationDefaultApplicationType: 'infer',
        // No client_credentials: its subject is not a user.
        grantTypes: ['authorization_code', 'refresh_token'],
        refreshTokenReuseInterval: 0,
        // Defence in depth behind `disabledPaths`: no user manages OAuth clients, and a signed-in
        // browser can't register one either (assistants register without cookies).
        clientPrivileges: () => false,
      }),
      // Client ID Metadata Documents: an https client_id the server fetches (SSRF-guarded).
      cimd({ fetchClientMetadataResource, metadataProfile: 'mcp-2026-07-28' }),
      // Personal access tokens for CLI tools. 120 requests a minute per key (default 10 a day).
      apiKey({
        defaultPrefix: API_KEY_PREFIX,
        maximumNameLength: 60,
        startingCharactersConfig: { charactersLength: 8 },
        rateLimit: { enabled: true, timeWindow: 60_000, maxRequests: 120 },
      }),
      // Verify, sign in and reset a password with a code sent on WhatsApp. Numbers are E.164 only
      // (src/lib/phone.ts normalises what people type before it reaches the API). The plugin refuses a
      // sign-up body that carries a phone number: a number becomes verified only through a code.
      phoneNumber({
        otpLength: 6,
        expiresIn: PHONE_CODE_TTL_SECONDS,
        allowedAttempts: PHONE_CODE_ATTEMPTS,
        requireVerification: true,
        phoneNumberValidator: (phone) => toE164(phone) === phone,
        sendOTP: (data, ctx) => deliverPhoneCode(database, data, ctx),
        sendPasswordResetOTP: (data, ctx) => deliverPhoneCode(database, data, ctx),
      }),
      // Must stay last: lets Server Actions set the session cookie.
      ...(options.nextCookies === false ? [] : [nextCookies()]),
    ],
  })
}

export type Auth = ReturnType<typeof createAuth>

let instance: Auth | undefined

/**
 * The app's Better Auth instance, created on first use: creating it starts the OAuth provider's
 * startup work (seeding the MCP resource row), which must not run when a module is merely
 * imported (`next build`, unit tests).
 */
export function getAuth(): Auth {
  return (instance ??= createAuth(db))
}

export const auth: Auth = new Proxy({} as Auth, {
  get(_target, prop) {
    const real = getAuth()
    const value = Reflect.get(real, prop, real)
    return typeof value === 'function' ? value.bind(real) : value
  },
  has(_target, prop) {
    return Reflect.has(getAuth(), prop)
  },
})
