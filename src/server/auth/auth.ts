import { betterAuth } from 'better-auth'
import { drizzleAdapter } from 'better-auth/adapters/drizzle'
import { APIError } from 'better-auth/api'
import { nextCookies } from 'better-auth/next-js'
import { isLocale } from '@/i18n/locale'
import { config } from '@/server/core/config'
import { AppError } from '@/server/core/errors'
import { db } from '@/server/db'
import * as schema from '@/server/db/schema'
import { sendEmail } from '@/server/email/send'
import { emailSubject, VerifyEmail } from '@/server/email/templates/verify-email'
import { assertValidSignup } from './signup-rules'

export const auth = betterAuth({
  database: drizzleAdapter(db, { provider: 'pg', schema }),
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
            if (err instanceof AppError) {
              throw new APIError('BAD_REQUEST', { message: err.message, code: err.code })
            }
            throw err
          }
        },
      },
    },
  },
  // Must stay last: lets Server Actions set the session cookie.
  plugins: [nextCookies()],
})

export type Auth = typeof auth
