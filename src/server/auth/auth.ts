import { apiKey } from '@better-auth/api-key'
import { cimd } from '@better-auth/cimd'
import { fetchClientMetadataResource } from '@better-auth/cimd/node'
import { mcp } from '@better-auth/mcp'
import { betterAuth } from 'better-auth'
import { and, eq, gte, like, ne } from 'drizzle-orm'
import { drizzleAdapter } from 'better-auth/adapters/drizzle'
import { APIError, createAuthMiddleware, getOAuthState, getSessionFromCtx } from 'better-auth/api'
import { nextCookies } from 'better-auth/next-js'
import { jwt, phoneNumber } from 'better-auth/plugins'
import { waitUntil } from '@vercel/functions'
import { CLIENT_IP_HEADER } from '@/lib/client-ip'
import { isLocale } from '@/i18n/locale'
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
import { ResetPasswordEmail } from '@/server/email/templates/reset-password'
import { emailSubject, VerifyEmail } from '@/server/email/templates/verify-email'
import { googleCredentials, signupFieldsFromOAuthState } from './google'
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


/** Sends a WhatsApp code to a phone number. Replaced by the real sender in a later task; until then it refuses. */
async function sendVerificationCode(): Promise<void> {
  throw new Error('WhatsApp codes are not wired up yet')
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

export function createAuth(database: Db, options: CreateAuthOptions = {}) {
  const origin = resolveAppOrigin(options.baseURL)
  const google = options.google === undefined ? googleCredentials() : options.google
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
    disabledPaths: [
      '/token',
      '/api-key/create',
      '/api-key/update',
      '/api-key/delete',
      '/api-key/list',
      '/api-key/get',
      ...OAUTH_CLIENT_MANAGEMENT_PATHS,
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
      // Only a verified lecturer can allow an assistant (denying stays open to everyone).
      before: createAuthMiddleware(async (ctx) => {
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
      onPasswordReset: async ({ user }) => {
        if (user.emailVerified) return
        await database.update(schema.user).set({ emailVerified: true, updatedAt: now() }).where(eq(schema.user.id, user.id))
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
      accountLinking: {
        // Signing in with Google under the email of an existing account joins that account, but
        // only once its email is verified: otherwise someone could register another person's
        // address with a password and keep access after the owner arrives through Google.
        // Refused attempts come back with `error=account_not_linked` (auth.google.notLinked tells
        // the user to confirm the address first). Google itself is deliberately not a trusted
        // provider: it reports verified emails anyway, and trusting it would not lift this rule.
        requireLocalEmailVerified: true,
        // Linking from Settings (signed in) may use a Google account with another address, e.g. a
        // personal Gmail for an account made with a school email.
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
        sendOTP: sendVerificationCode,
        sendPasswordResetOTP: sendVerificationCode,
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
