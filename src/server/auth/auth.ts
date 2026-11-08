import { apiKey } from '@better-auth/api-key'
import { cimd } from '@better-auth/cimd'
import { fetchClientMetadataResource } from '@better-auth/cimd/node'
import { mcp } from '@better-auth/mcp'
import { betterAuth } from 'better-auth'
import { drizzleAdapter } from 'better-auth/adapters/drizzle'
import { APIError } from 'better-auth/api'
import { nextCookies } from 'better-auth/next-js'
import { jwt } from 'better-auth/plugins'
import { isLocale } from '@/i18n/locale'
import { config } from '@/server/core/config'
import { AppError } from '@/server/core/errors'
import { db, type Db } from '@/server/db'
import * as schema from '@/server/db/schema'
import { sendEmail } from '@/server/email/send'
import { emailSubject, VerifyEmail } from '@/server/email/templates/verify-email'
import { assertValidSignup, assertValidUserUpdate } from './signup-rules'

type CreateAuthOptions = {
  baseURL?: string
  secret?: string
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
  return err instanceof AppError
    ? new APIError('BAD_REQUEST', { message: err.message, code: err.code })
    : err
}

export function createAuth(database: Db, options: CreateAuthOptions = {}) {
  const origin = resolveAppOrigin(options.baseURL)
  return betterAuth({
    baseURL: origin,
    ...(options.secret ? { secret: options.secret } : {}),
    // The jwt plugin's /token would hand out session JWTs; MCP uses OAuth access tokens only.
    disabledPaths: ['/token'],
    database: drizzleAdapter(database, { provider: 'pg', schema }),
    emailAndPassword: {
      enabled: true,
      requireEmailVerification: config.requireEmailVerification,
    },
    emailVerification: {
      sendOnSignUp: config.requireEmailVerification,
      // An unverified user who signs in (e.g. after the first link expired) gets a fresh link,
      // instead of being stuck with no way to verify.
      sendOnSignIn: config.requireEmailVerification,
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
          react: VerifyEmail({ name: user.name, url, locale }),
        })
      },
    },
    rateLimit: {
      ...(options.rateLimitEnabled !== undefined ? { enabled: options.rateLimitEnabled } : {}),
      storage: 'memory',
      customRules: {
        '/sign-in/email': SIGN_IN_RULE,
        '/sign-up/email': SIGN_UP_RULE,
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
              return { data: { ...user, role, locale } }
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
              assertValidUserUpdate(data as Record<string, unknown>)
            } catch (err) {
              throw toApiError(err)
            }
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
        // No client_credentials: its subject is not a user.
        grantTypes: ['authorization_code', 'refresh_token'],
        refreshTokenReuseInterval: 0,
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
      // Must stay last: lets Server Actions set the session cookie.
      ...(options.nextCookies === false ? [] : [nextCookies()]),
    ],
  })
}

export const auth = createAuth(db)

export type Auth = typeof auth
