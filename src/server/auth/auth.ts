import { betterAuth } from 'better-auth'
import { drizzleAdapter } from 'better-auth/adapters/drizzle'
import { APIError } from 'better-auth/api'
import { nextCookies } from 'better-auth/next-js'
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
}

function toApiError(err: unknown): unknown {
  return err instanceof AppError
    ? new APIError('BAD_REQUEST', { message: err.message, code: err.code })
    : err
}

export function createAuth(database: Db, options: CreateAuthOptions = {}) {
  return betterAuth({
    ...(options.baseURL ? { baseURL: options.baseURL } : {}),
    ...(options.secret ? { secret: options.secret } : {}),
    database: drizzleAdapter(database, { provider: 'pg', schema }),
    emailAndPassword: {
      enabled: true,
      requireEmailVerification: config.requireEmailVerification,
    },
    emailVerification: {
      sendOnSignUp: config.requireEmailVerification,
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
    // Must stay last: lets Server Actions set the session cookie.
    plugins: options.nextCookies === false ? [] : [nextCookies()],
  })
}

export const auth = createAuth(db)

export type Auth = typeof auth
