import { createVerify } from 'node:crypto'
import { and, eq, inArray } from 'drizzle-orm'
import { AppError } from '@/server/core/errors'
import type { Db } from '@/server/db'
import { whatsappMessage } from '@/server/db/schema'
import { normalizePhone, whatsAppConfig } from './config'
import { handleInboundMessage } from './link'

export type InboundText = { from: string; text: string; at: Date }
export type DeliveryStatus = { messageId: string; status: 'sent' | 'delivered' | 'read' | 'failed'; error?: string }

const STATUS_VALUES = ['sent', 'delivered', 'read', 'failed'] as const

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

/**
 * Reads the Meta webhook entry that AWS puts in `whatsAppWebhookEntry` (a JSON string): the text
 * messages people sent us and the delivery statuses of what we sent. Anything else (images,
 * reactions, malformed items) is skipped. Throws only when the string is not JSON.
 */
export function parseWhatsAppEntry(entryJson: string): { messages: InboundText[]; statuses: DeliveryStatus[] } {
  const entry: unknown = JSON.parse(entryJson)
  const messages: InboundText[] = []
  const statuses: DeliveryStatus[] = []
  const changes = isRecord(entry) && Array.isArray(entry.changes) ? entry.changes : []
  for (const change of changes) {
    const value = isRecord(change) ? change.value : undefined
    if (!isRecord(value)) continue
    for (const m of Array.isArray(value.messages) ? value.messages : []) {
      if (!isRecord(m) || m.type !== 'text' || typeof m.from !== 'string') continue
      const body = isRecord(m.text) ? m.text.body : undefined
      if (typeof body !== 'string') continue
      const seconds = Number(m.timestamp)
      const at = Number.isFinite(seconds) && seconds > 0 ? new Date(seconds * 1000) : new Date()
      messages.push({ from: m.from, text: body, at })
    }
    for (const s of Array.isArray(value.statuses) ? value.statuses : []) {
      if (!isRecord(s) || typeof s.id !== 'string') continue
      const status = STATUS_VALUES.find((v) => v === s.status)
      if (!status) continue
      const first = Array.isArray(s.errors) ? s.errors[0] : undefined
      let error: string | undefined
      if (isRecord(first)) {
        const text = [first.title, first.message].find((x) => typeof x === 'string' && x !== '')
        error = [first.code, text].filter((x) => x !== undefined && x !== '').join(' ') || undefined
      }
      statuses.push(error ? { messageId: s.id, status, error } : { messageId: s.id, status })
    }
  }
  return { messages, statuses }
}

// A row only moves forward: sent -> delivered -> read. A failure only replaces "sent".
const MOVES_FROM: Record<DeliveryStatus['status'], ('sent' | 'delivered' | 'read' | 'failed')[]> = {
  sent: [],
  delivered: ['sent'],
  read: ['sent', 'delivered'],
  failed: ['sent'],
}

/** Applies delivery statuses, in order, to the rows whose `providerMessageId` matches. Unknown ids are ignored. */
export async function recordStatuses(db: Db, statuses: DeliveryStatus[]): Promise<void> {
  for (const s of statuses) {
    const from = MOVES_FROM[s.status]
    if (from.length === 0) continue
    await db
      .update(whatsappMessage)
      .set({ status: s.status, error: s.status === 'failed' ? (s.error ?? null) : null, updatedAt: new Date() })
      .where(and(eq(whatsappMessage.providerMessageId, s.messageId), inArray(whatsappMessage.status, from)))
  }
}

export type SnsMessage = {
  Type?: string
  MessageId?: string
  TopicArn?: string
  Subject?: string
  Message?: string
  Timestamp?: string
  Token?: string
  SubscribeURL?: string
  SigningCertURL?: string
  Signature?: string
  SignatureVersion?: string
}

const NOTIFICATION_FIELDS = ['Message', 'MessageId', 'Subject', 'Timestamp', 'TopicArn', 'Type'] as const
const CONFIRMATION_FIELDS = ['Message', 'MessageId', 'SubscribeURL', 'Timestamp', 'Token', 'TopicArn', 'Type'] as const

/** The exact text SNS signed: `Key\nValue\n` for each field, in alphabetical order, skipping an absent Subject. */
export function snsStringToSign(msg: SnsMessage): string | null {
  const fields = msg.Type === 'Notification' ? NOTIFICATION_FIELDS : CONFIRMATION_FIELDS
  let out = ''
  for (const key of fields) {
    const value = msg[key]
    if (value === undefined) {
      if (key === 'Subject') continue
      return null
    }
    out += `${key}\n${value}\n`
  }
  return out
}

/** Only SNS's own endpoint for the configured region: https://sns.<region>.amazonaws.com/... */
export function isSnsUrl(raw: string | undefined, region: string, pathSuffix?: string): boolean {
  if (!raw) return false
  let url: URL
  try {
    url = new URL(raw)
  } catch {
    return false
  }
  return (
    url.protocol === 'https:' &&
    url.hostname === `sns.${region}.amazonaws.com` &&
    url.port === '' &&
    url.username === '' &&
    url.password === '' &&
    (pathSuffix === undefined || url.pathname.endsWith(pathSuffix))
  )
}

const certCache = new Map<string, string>()

async function fetchCertificate(url: string): Promise<string> {
  const cached = certCache.get(url)
  if (cached) return cached
  const res = await fetch(url, { redirect: 'error', signal: AbortSignal.timeout(5000) })
  if (!res.ok) throw new Error(`Could not fetch the SNS certificate (${res.status})`)
  const pem = await res.text()
  if (pem.length > 20_000 || !pem.includes('BEGIN CERTIFICATE')) throw new Error('Not an SNS certificate')
  certCache.set(url, pem)
  return pem
}

/**
 * Checks the SNS signature (SHA1 for SignatureVersion 1, SHA256 for 2) against the certificate
 * at `SigningCertURL`, which must be on SNS's own host for our region. False when anything is
 * off; a certificate that cannot be fetched also gives false (the message is refused, SNS retries).
 */
export async function verifySnsSignature(
  msg: SnsMessage,
  region: string,
  getCertificate: (url: string) => Promise<string> = fetchCertificate,
): Promise<boolean> {
  if (!isSnsUrl(msg.SigningCertURL, region, '.pem') || !msg.Signature) return false
  const algorithm = msg.SignatureVersion === '1' ? 'RSA-SHA1' : msg.SignatureVersion === '2' ? 'RSA-SHA256' : null
  const toSign = snsStringToSign(msg)
  if (!algorithm || toSign === null) return false
  try {
    const pem = await getCertificate(msg.SigningCertURL as string)
    return createVerify(algorithm).update(toSign, 'utf8').verify(pem, msg.Signature, 'base64')
  } catch (err) {
    console.error('[whatsapp] could not verify an SNS message', err)
    return false
  }
}

let testVerifier: ((body: SnsMessage) => Promise<boolean>) | null = null

/** Replaces signature verification in tests. Pass null to restore the real one. */
export function setSnsVerifierForTests(fn: ((body: SnsMessage) => Promise<boolean>) | null): void {
  testVerifier = fn
}

export type SnsResult = { status: number; body: string }

const ok = (): SnsResult => ({ status: 200, body: 'ok' })

/**
 * Handles one POST from the SNS topic that AWS publishes WhatsApp events to. 404 when WhatsApp is
 * off, 400 for a body that is not an SNS message, 403 for a bad signature or another topic, 200
 * once handled. A database error gives 500 so SNS delivers the message again.
 */
export async function handleSnsPost(db: Db, rawBody: string): Promise<SnsResult> {
  const config = whatsAppConfig()
  if (!config) return { status: 404, body: 'not found' }

  let msg: SnsMessage
  try {
    const parsed: unknown = JSON.parse(rawBody)
    if (!isRecord(parsed) || typeof parsed.Type !== 'string') return { status: 400, body: 'bad request' }
    msg = parsed as SnsMessage
  } catch {
    return { status: 400, body: 'bad request' }
  }

  const verified = testVerifier ? await testVerifier(msg) : await verifySnsSignature(msg, config.region)
  if (!verified || msg.TopicArn !== config.topicArn) return { status: 403, body: 'forbidden' }

  if (msg.Type === 'SubscriptionConfirmation') {
    if (!isSnsUrl(msg.SubscribeURL, config.region)) return { status: 403, body: 'forbidden' }
    try {
      const res = await fetch(msg.SubscribeURL as string, { redirect: 'error', signal: AbortSignal.timeout(5000) })
      if (!res.ok) return { status: 502, body: 'could not confirm' }
    } catch (err) {
      console.error('[whatsapp] could not confirm the SNS subscription', err)
      return { status: 502, body: 'could not confirm' }
    }
    return ok()
  }
  if (msg.Type !== 'Notification') return ok()

  let parsed: ReturnType<typeof parseWhatsAppEntry>
  try {
    const envelope: unknown = JSON.parse(msg.Message ?? '')
    const entry = isRecord(envelope) ? envelope.whatsAppWebhookEntry : undefined
    if (typeof entry !== 'string') return ok()
    parsed = parseWhatsAppEntry(entry)
  } catch (err) {
    // Not something a retry can fix.
    console.error('[whatsapp] ignored an unreadable SNS notification', err)
    return ok()
  }

  let retry = false
  const attempt = async (what: string, run: () => Promise<void>) => {
    try {
      await run()
    } catch (err) {
      console.error(`[whatsapp] ${what} failed`, err)
      if (!(err instanceof AppError)) retry = true
    }
  }
  for (const m of parsed.messages) {
    const from = normalizePhone(m.from)
    if (!from) continue
    await attempt('handling an inbound message', () => handleInboundMessage(db, { from, text: m.text, at: m.at }))
  }
  if (parsed.statuses.length > 0) await attempt('recording delivery statuses', () => recordStatuses(db, parsed.statuses))
  return retry ? { status: 500, body: 'error' } : ok()
}
