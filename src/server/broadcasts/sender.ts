import { SESv2Client, SendEmailCommand } from '@aws-sdk/client-sesv2'
import { render } from '@react-email/render'
import { createElement } from 'react'
import { isProductionDeploy } from '@/lib/deploy-env'
import { supportEmail } from '@/lib/contact'
import type { Locale } from '@/server/core/context'
import { BroadcastEmail } from '@/server/email/templates/broadcast'
import { maskEmail, scrubError } from '@/server/ops/events'

/** The same fallback sender as `sendEmail`, for when `EMAIL_FROM` is not set. */
const DEFAULT_FROM = 'Clasync <onboarding@resend.dev>'

/** One announcement email, ready to send. `unsubscribeUrl` is the one-click address for the mail headers. */
export type OutgoingBroadcast = {
  to: string
  subject: string
  html: string
  text: string
  unsubscribeUrl: string
}

export type BroadcastSender = {
  kind: 'ses' | 'log'
  send(email: OutgoingBroadcast): Promise<{ ok: true } | { ok: false; error: string }>
}

type Env = Record<string, string | undefined>

const globalForSes = globalThis as typeof globalThis & { __clasyncSes?: { key: string; client: SESv2Client } }

function client(region: string): SESv2Client {
  const cached = globalForSes.__clasyncSes
  if (cached && cached.key === region) return cached.client
  // A hung request must not hold the sending job: give up on one email after 10 s (it is marked failed).
  const created = new SESv2Client({
    region,
    requestHandler: { connectionTimeout: 5_000, requestTimeout: 10_000, throwOnRequestTimeout: true },
  })
  globalForSes.__clasyncSes = { key: region, client: created }
  return created
}

function sesSender(region: string, env: Env): BroadcastSender {
  return {
    kind: 'ses',
    async send(email) {
      try {
        await client(region).send(
          new SendEmailCommand({
            FromEmailAddress: env.EMAIL_FROM || DEFAULT_FROM,
            ReplyToAddresses: [supportEmail()],
            Destination: { ToAddresses: [email.to] },
            Content: {
              Simple: {
                Subject: { Data: email.subject, Charset: 'UTF-8' },
                Body: {
                  Html: { Data: email.html, Charset: 'UTF-8' },
                  Text: { Data: email.text, Charset: 'UTF-8' },
                },
                Headers: [
                  { Name: 'List-Unsubscribe', Value: `<${email.unsubscribeUrl}>` },
                  { Name: 'List-Unsubscribe-Post', Value: 'List-Unsubscribe=One-Click' },
                ],
              },
            },
          }),
        )
        return { ok: true }
      } catch (err) {
        return { ok: false, error: scrubError(err instanceof Error ? err.message : String(err)) }
      }
    },
  }
}

/** Local development without Amazon SES: only the masked recipient and the subject are logged, never the body. */
const logSender: BroadcastSender = {
  kind: 'log',
  async send(email) {
    console.info('[broadcast] SES_REGION not set, email not sent', { to: maskEmail(email.to), subject: email.subject })
    return { ok: true }
  },
}

let override: BroadcastSender | null = null

/** Replaces the sender in tests. Pass null to restore the default. */
export function setBroadcastSenderForTests(sender: BroadcastSender | null): void {
  override = sender
}

/**
 * Where announcements go out: Amazon SES when `SES_REGION` is set (credentials from the default AWS
 * chain), a log line outside production when it is not, and `null` in production without it, so the
 * caller can refuse to start a send instead of silently dropping mail.
 */
export function broadcastSender(env: Env = process.env): BroadcastSender | null {
  if (override) return override
  const region = env.SES_REGION?.trim()
  if (region) return sesSender(region, env)
  return isProductionDeploy(env) ? null : logSender
}

/** Builds the subject, HTML and plain-text parts of one announcement for one recipient. */
export async function renderBroadcast(args: {
  locale: Locale
  subject: string
  body: string
  to: string
  unsubscribeUrl: string
  unsubscribePageUrl: string
}): Promise<OutgoingBroadcast> {
  const react = createElement(BroadcastEmail, {
    locale: args.locale,
    body: args.body,
    unsubscribePageUrl: args.unsubscribePageUrl,
  })
  return {
    to: args.to,
    subject: args.subject.replace(/\s+/g, ' ').trim(),
    html: await render(react),
    text: await render(react, { plainText: true }),
    unsubscribeUrl: args.unsubscribeUrl,
  }
}
