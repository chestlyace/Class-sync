import type { ReactElement } from 'react'
import { Resend } from 'resend'

const DEFAULT_FROM = 'Clasync <onboarding@resend.dev>'

/**
 * Sends an email through Resend. Without RESEND_API_KEY (local development) nothing is
 * sent: only the recipient and subject are logged, never the body.
 */
export async function sendEmail(args: {
  to: string
  subject: string
  react: ReactElement
}): Promise<void> {
  const apiKey = process.env.RESEND_API_KEY
  if (!apiKey) {
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
