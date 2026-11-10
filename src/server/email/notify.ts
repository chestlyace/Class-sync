import type { ReactElement } from 'react'
import { Resend } from 'resend'
import type { Locale } from '@/server/core/context'
import { runAfterResponse } from '@/server/lib/after-response'
import { isAllowedRecipient } from './allowlist'

export type Notification = { to: string; locale: Locale; subject: string; react: ReactElement }

type BatchPayload = Array<{ from: string; to: string; subject: string; react: ReactElement }>

/** The slice of the Resend client this module uses, so tests can substitute it. */
export type NotifyClient = {
  batch: { send(payload: BatchPayload): Promise<{ error: { message: string } | null }> }
}

const DEFAULT_FROM = 'Clasync <onboarding@resend.dev>'
const BATCH_SIZE = 100

let clientFactory: ((apiKey: string) => NotifyClient) | null = null

/** Replaces the Resend client in tests. Pass null to restore the real one. */
export function setResendClientFactoryForTests(factory: ((apiKey: string) => NotifyClient) | null): void {
  clientFactory = factory
}

const RETRY_DELAY_MS = 750

let wait: (ms: number) => Promise<void> = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

/** Replaces the pause before a chunk's retry in tests. Pass null to restore the real timer. */
export function setRetryWaitForTests(fn: ((ms: number) => Promise<void>) | null): void {
  wait = fn ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)))
}

function createClient(apiKey: string): NotifyClient {
  if (clientFactory) return clientFactory(apiKey)
  return new Resend(apiKey) as unknown as NotifyClient
}

async function sendChunk(client: NotifyClient, payload: BatchPayload): Promise<boolean> {
  try {
    const { error } = await client.batch.send(payload)
    if (!error) return true
    console.error('[notify] batch failed', { size: payload.length, message: error.message })
  } catch (error) {
    console.error('[notify] batch threw', { size: payload.length, error })
  }
  return false
}

/**
 * Best-effort notification delivery through Resend's batch API (100 emails per call, one retry
 * per failed chunk after a short pause). It never throws, in any environment: a missing key or a provider outage must
 * not fail the action that triggered the notification. Without RESEND_API_KEY nothing is sent and
 * a single warning with the count (never the addresses) is logged.
 */
export async function sendNotifications(
  items: Notification[],
): Promise<{ sent: number; skipped: number; failed: number }> {
  const result = { sent: 0, skipped: 0, failed: 0 }
  const allowed = items.filter((n) => isAllowedRecipient(n.to))
  if (allowed.length < items.length) {
    result.skipped = items.length - allowed.length
    console.info(`[notify] ${result.skipped} notification email(s) to recipients not on EMAIL_ALLOWLIST not sent`)
    items = allowed
  }
  if (items.length === 0) return result

  const apiKey = process.env.RESEND_API_KEY
  if (!apiKey) {
    console.warn(`[notify] RESEND_API_KEY is not set: ${items.length} notification email(s) not sent`)
    result.skipped += items.length
    return result
  }

  let client: NotifyClient
  try {
    client = createClient(apiKey)
  } catch (error) {
    console.error('[notify] could not create the email client', error)
    result.failed = items.length
    return result
  }

  const from = process.env.EMAIL_FROM || DEFAULT_FROM
  for (let i = 0; i < items.length; i += BATCH_SIZE) {
    const chunk = items.slice(i, i + BATCH_SIZE)
    const payload: BatchPayload = chunk.map((n) => ({ from, to: n.to, subject: n.subject, react: n.react }))
    let ok = await sendChunk(client, payload)
    if (!ok) {
      await wait(RETRY_DELAY_MS)
      ok = await sendChunk(client, payload)
    }
    if (ok) result.sent += chunk.length
    else result.failed += chunk.length
  }
  return result
}

/**
 * Prepares notification emails now and sends them after the response, for confirmations that
 * follow a user's action (joining a class, handing in work). Never throws: a failure while
 * gathering what the emails need is logged and nothing is sent, and sending is best effort
 * (sendNotifications), so the action that triggered it always stands.
 */
export async function queueNotifications(context: string, build: () => Promise<Notification[]>): Promise<void> {
  let items: Notification[]
  try {
    items = await build()
  } catch (error) {
    console.error(`[${context}] could not prepare notification emails`, error)
    return
  }
  if (items.length === 0) return
  runAfterResponse(async () => {
    await sendNotifications(items)
  })
}

/**
 * Builds absolute links into the app for emails, from BETTER_AUTH_URL. Without it the links are
 * relative and one warning is logged per builder (i.e. per batch of emails), never per recipient.
 */
export function appLinkBuilder(context: string): (path: string) => string {
  const base = (process.env.BETTER_AUTH_URL ?? '').replace(/\/+$/, '')
  if (!base) console.warn(`[${context}] BETTER_AUTH_URL is not set: notification emails will carry relative links`)
  return (path) => `${base}${path}`
}
