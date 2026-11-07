import type { ReactElement } from 'react'
import { Resend } from 'resend'

const DEFAULT_FROM = 'Clasync <onboarding@resend.dev>'

/**
 * Sends an email through Resend. Without RESEND_API_KEY nothing is sent: in production that is a
 * misconfiguration and throws (users would otherwise wait for links that never come); in local
 * development only the recipient and subject are logged, never the body.
 */
export async function sendEmail(args: {
  to: string
  subject: string
  react: ReactElement
}): Promise<void> {
  const apiKey = process.env.RESEND_API_KEY
  if (!apiKey) {
    if (process.env.NODE_ENV === 'production') {
      throw new Error(
        'RESEND_API_KEY is not set: refusing to drop an email in production. Set RESEND_API_KEY, or set AUTH_REQUIRE_EMAIL_VERIFICATION=false until email is configured.',
      )
    }
    console.info('[email] RESEND_API_KEY not set, email not sent', {
      to: args.to,
      subject: args.subject,
    })
    return
  }
  const { error } = await new Resend(apiKey).emails.send({
    from: process.env.EMAIL_FROM || DEFAULT_FROM,
    to: args.to,
    subject: args.subject,
    react: args.react,
  })
  if (error) throw new Error(`Failed to send email: ${error.message}`)
}
