import type { ReactElement } from 'react'
import { render } from '@react-email/render'
import { Resend } from 'resend'
import { supportEmail } from '@/lib/contact'
import { dropSuspendedRecipients, maskEmail, recordOpsEvent, scrubError } from '@/server/ops/events'
import { isAllowedRecipient } from './allowlist'
import { emailDb } from './db'
import type { EmailKind } from './templates/verify-email'

const DEFAULT_FROM = 'Clasync <onboarding@resend.dev>'

/**
 * Sends an email through Resend. Without RESEND_API_KEY nothing is sent: in production that is a
 * misconfiguration and throws (users would otherwise wait for links that never come); in local
 * development only the recipient and subject are logged, never the body. A suspended user's
 * address gets nothing. Every email carries a plain-text part next to the HTML: providers such as
 * iCloud reject HTML-only mail from new domains (`554 5.7.1 [HM08]`). A send that reaches Resend
 * records an `email_sent` or `email_failed`
 * health event (masked address, kind, error text); a skip records nothing.
 */
export async function sendEmail(args: {
  to: string
  subject: string
  react: ReactElement
  kind: EmailKind
}): Promise<void> {
  if (!isAllowedRecipient(args.to)) {
    console.info('[email] recipient not on EMAIL_ALLOWLIST, email not sent', {
      to: args.to,
      subject: args.subject,
    })
    return
  }
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
  const db = emailDb()
  if ((await dropSuspendedRecipients(db, [args.to])).size > 0) {
    console.info('[email] recipient is suspended, email not sent', { kind: args.kind })
    return
  }
  const { error } = await new Resend(apiKey).emails.send({
    from: process.env.EMAIL_FROM || DEFAULT_FROM,
    replyTo: supportEmail(),
    to: args.to,
    subject: args.subject,
    react: args.react,
    text: await render(args.react, { plainText: true }),
  })
  const detail = { kind: args.kind, to: maskEmail(args.to) }
  if (error) {
    await recordOpsEvent(db, { kind: 'email_failed', ok: false, detail: { ...detail, error: scrubError(error.message) } })
    throw new Error(`Failed to send email: ${error.message}`)
  }
  await recordOpsEvent(db, { kind: 'email_sent', ok: true, detail })
}
