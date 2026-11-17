import { generateKeyPairSync, createSign } from 'node:crypto'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { eq } from 'drizzle-orm'
import { whatsappMessage } from '@/server/db/schema'
import { createTestDb } from '@/test/db'
import { makeUser } from '@/test/factories'
import {
  handleSnsPost,
  isSnsUrl,
  parseWhatsAppEntry,
  recordStatuses,
  setSnsVerifierForTests,
  snsStringToSign,
  verifySnsSignature,
  type SnsMessage,
} from './inbound'

const handled = vi.hoisted(() => [] as { from: string; text: string; at: Date }[])
vi.mock('./link', () => ({
  handleInboundMessage: async (_db: unknown, msg: { from: string; text: string; at: Date }) => {
    if (msg.text === 'BOOM') throw new Error('database is down')
    handled.push(msg)
  },
}))

const TOPIC = 'arn:aws:sns:eu-west-1:1:t'

const statusEntry = JSON.stringify({
  id: '1',
  changes: [
    {
      field: 'messages',
      value: {
        messaging_product: 'whatsapp',
        metadata: { display_phone_number: '15550100000', phone_number_id: 'p1' },
        statuses: [
          { id: 'wamid.A', status: 'delivered', timestamp: '1700000000', recipient_id: '237612345678' },
          {
            id: 'wamid.B',
            status: 'failed',
            timestamp: '1700000001',
            recipient_id: '237612345679',
            errors: [{ code: 131026, title: 'Message undeliverable', message: 'Message undeliverable' }],
          },
        ],
      },
    },
  ],
})

const textEntry = JSON.stringify({
  id: '1',
  changes: [
    {
      field: 'messages',
      value: {
        messaging_product: 'whatsapp',
        contacts: [{ profile: { name: 'Ada' }, wa_id: '237612345678' }],
        messages: [
          { from: '237612345678', id: 'wamid.X', timestamp: '1700000000', type: 'text', text: { body: 'JOIN ABC234' } },
          { from: '237612345678', id: 'wamid.Y', timestamp: '1700000000', type: 'image', image: { id: 'i' } },
        ],
      },
    },
  ],
})

function notification(entry: string, over: Partial<SnsMessage> = {}): string {
  return JSON.stringify({
    Type: 'Notification',
    MessageId: 'm1',
    TopicArn: TOPIC,
    Message: JSON.stringify({ context: {}, whatsAppWebhookEntry: entry }),
    Timestamp: '2026-11-17T10:00:00.000Z',
    SignatureVersion: '1',
    Signature: 'x',
    SigningCertURL: 'https://sns.eu-west-1.amazonaws.com/c.pem',
    ...over,
  })
}

beforeEach(() => {
  handled.length = 0
  vi.stubEnv('WHATSAPP_AWS_REGION', 'eu-west-1')
  vi.stubEnv('WHATSAPP_AWS_ROLE_ARN', 'arn:aws:iam::1:role/x')
  vi.stubEnv('WHATSAPP_PHONE_NUMBER_ID', 'phone-number-id-1')
  vi.stubEnv('WHATSAPP_DISPLAY_NUMBER', '+1 555 010 0000')
  vi.stubEnv('WHATSAPP_SNS_TOPIC_ARN', TOPIC)
  setSnsVerifierForTests(async () => true)
})

afterEach(() => {
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
  setSnsVerifierForTests(null)
})

describe('parseWhatsAppEntry', () => {
  it('reads statuses and the failure reason', () => {
    expect(parseWhatsAppEntry(statusEntry)).toEqual({
      messages: [],
      statuses: [
        { messageId: 'wamid.A', status: 'delivered' },
        { messageId: 'wamid.B', status: 'failed', error: '131026 Message undeliverable' },
      ],
    })
  })

  it('reads text messages and skips other types', () => {
    const { messages, statuses } = parseWhatsAppEntry(textEntry)
    expect(statuses).toEqual([])
    expect(messages).toEqual([{ from: '237612345678', text: 'JOIN ABC234', at: new Date(1700000000 * 1000) }])
  })

  it('skips malformed items and throws on non-JSON', () => {
    expect(parseWhatsAppEntry('{"changes":[{"value":{"messages":[1,{"type":"text"}],"statuses":[{"id":"a","status":"weird"}]}}]}')).toEqual({
      messages: [],
      statuses: [],
    })
    expect(() => parseWhatsAppEntry('nope')).toThrow()
  })
})

describe('recordStatuses', () => {
  async function setup(status: 'sent' | 'delivered' | 'read' | 'failed') {
    const db = await createTestDb()
    const u = await makeUser(db)
    await db.insert(whatsappMessage).values({
      userId: u.id,
      kind: 'checkinOpen',
      eventKey: 'e1',
      template: 'checkin_open',
      providerMessageId: 'wamid.A',
      status,
    })
    const read = async () => (await db.select().from(whatsappMessage).where(eq(whatsappMessage.providerMessageId, 'wamid.A')))[0]
    return { db, read }
  }

  it('moves forward and records the failure reason', async () => {
    const { db, read } = await setup('sent')
    await recordStatuses(db, [{ messageId: 'wamid.A', status: 'delivered' }])
    expect((await read()).status).toBe('delivered')
    await recordStatuses(db, [{ messageId: 'wamid.A', status: 'read' }])
    expect((await read()).status).toBe('read')
    const f = await setup('sent')
    await recordStatuses(f.db, [{ messageId: 'wamid.A', status: 'failed', error: '131026 Undeliverable' }])
    expect(await f.read()).toMatchObject({ status: 'failed', error: '131026 Undeliverable' })
  })

  it('never moves a row backwards', async () => {
    const { db, read } = await setup('read')
    await recordStatuses(db, [
      { messageId: 'wamid.A', status: 'delivered' },
      { messageId: 'wamid.A', status: 'sent' },
      { messageId: 'wamid.A', status: 'failed', error: 'x' },
    ])
    expect(await read()).toMatchObject({ status: 'read', error: null })
    const d = await setup('delivered')
    await recordStatuses(d.db, [{ messageId: 'wamid.A', status: 'failed' }, { messageId: 'wamid.A', status: 'sent' }])
    expect((await d.read()).status).toBe('delivered')
  })

  it('ignores unknown message ids', async () => {
    const { db } = await setup('sent')
    await expect(recordStatuses(db, [{ messageId: 'wamid.zzz', status: 'read' }])).resolves.toBeUndefined()
  })
})

describe('handleSnsPost', () => {
  it('is 404 without config, 400 for a body that is not SNS', async () => {
    const db = await createTestDb()
    expect((await handleSnsPost(db, '{}')).status).toBe(400)
    expect((await handleSnsPost(db, 'not json')).status).toBe(400)
    vi.stubEnv('WHATSAPP_SNS_TOPIC_ARN', '')
    expect((await handleSnsPost(db, notification(textEntry))).status).toBe(404)
  })

  it('is 403 for another topic or when the signature check fails', async () => {
    const db = await createTestDb()
    expect((await handleSnsPost(db, notification(textEntry, { TopicArn: 'arn:aws:sns:eu-west-1:2:other' }))).status).toBe(403)
    setSnsVerifierForTests(async () => false)
    expect((await handleSnsPost(db, notification(textEntry))).status).toBe(403)
    expect(handled).toEqual([])
  })

  it('is 503 (retryable) when the signature could not be checked', async () => {
    const db = await createTestDb()
    setSnsVerifierForTests(async () => 'unavailable')
    expect((await handleSnsPost(db, notification(textEntry))).status).toBe(503)
    expect(handled).toEqual([])
  })

  it('hands each text to the linker with the number in E.164, and records statuses', async () => {
    const db = await createTestDb()
    const res = await handleSnsPost(db, notification(textEntry))
    expect(res.status).toBe(200)
    expect(handled).toEqual([{ from: '+237612345678', text: 'JOIN ABC234', at: new Date(1700000000 * 1000) }])
  })

  it('skips a sender that is not a phone number and carries on', async () => {
    const db = await createTestDb()
    const entry = JSON.stringify({
      changes: [
        {
          value: {
            messages: [
              { from: 'abc', type: 'text', text: { body: 'hi' }, timestamp: '1' },
              { from: '237612345678', type: 'text', text: { body: 'ok' }, timestamp: '1' },
            ],
          },
        },
      ],
    })
    expect((await handleSnsPost(db, notification(entry))).status).toBe(200)
    expect(handled.map((m) => m.text)).toEqual(['ok'])
  })

  it('applies statuses from a notification', async () => {
    const db = await createTestDb()
    const u = await makeUser(db)
    await db.insert(whatsappMessage).values({
      userId: u.id, kind: 'checkinOpen', eventKey: 'e', template: 't', providerMessageId: 'wamid.A', status: 'sent',
    })
    expect((await handleSnsPost(db, notification(statusEntry))).status).toBe(200)
    const [row] = await db.select().from(whatsappMessage)
    expect(row.status).toBe('delivered')
  })

  it('answers 500 after a failure, but still handles the other messages', async () => {
    const db = await createTestDb()
    const entry = JSON.stringify({
      changes: [
        {
          value: {
            messages: [
              { from: '237612345678', type: 'text', text: { body: 'BOOM' }, timestamp: '1' },
              { from: '237612345679', type: 'text', text: { body: 'fine' }, timestamp: '1' },
            ],
          },
        },
      ],
    })
    vi.spyOn(console, 'error').mockImplementation(() => {})
    expect((await handleSnsPost(db, notification(entry))).status).toBe(500)
    expect(handled.map((m) => m.text)).toEqual(['fine'])
  })

  it('answers 200 for a notification it cannot read (a retry would not help)', async () => {
    const db = await createTestDb()
    vi.spyOn(console, 'error').mockImplementation(() => {})
    expect((await handleSnsPost(db, notification('not json'))).status).toBe(200)
    expect((await handleSnsPost(db, JSON.stringify({ Type: 'Notification', TopicArn: TOPIC, Message: 'plain' }))).status).toBe(200)
  })

  it('confirms a subscription only through SNS\'s own host', async () => {
    const db = await createTestDb()
    const fetchMock = vi.fn(async () => new Response('ok'))
    vi.stubGlobal('fetch', fetchMock)
    const base = { Type: 'SubscriptionConfirmation', TopicArn: TOPIC, Message: 'hi', MessageId: 'm', Token: 't', Timestamp: 'now' }
    const evil = await handleSnsPost(db, JSON.stringify({ ...base, SubscribeURL: 'https://evil.example/?x=1' }))
    expect(evil.status).toBe(403)
    expect(fetchMock).not.toHaveBeenCalled()
    const good = await handleSnsPost(db, JSON.stringify({ ...base, SubscribeURL: 'https://sns.eu-west-1.amazonaws.com/?Action=ConfirmSubscription' }))
    expect(good.status).toBe(200)
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })
})

describe('isSnsUrl', () => {
  it('accepts only https on sns.<region>.amazonaws.com', () => {
    expect(isSnsUrl('https://sns.eu-west-1.amazonaws.com/a.pem', 'eu-west-1', '.pem')).toBe(true)
    expect(isSnsUrl('https://sns.us-east-1.amazonaws.com/a.pem', 'eu-west-1', '.pem')).toBe(false)
    expect(isSnsUrl('http://sns.eu-west-1.amazonaws.com/a.pem', 'eu-west-1', '.pem')).toBe(false)
    expect(isSnsUrl('https://sns.eu-west-1.amazonaws.com.evil.com/a.pem', 'eu-west-1', '.pem')).toBe(false)
    expect(isSnsUrl('https://sns.eu-west-1.amazonaws.com@evil.com/a.pem', 'eu-west-1', '.pem')).toBe(false)
    expect(isSnsUrl('https://sns.eu-west-1.amazonaws.com/a.txt', 'eu-west-1', '.pem')).toBe(false)
    expect(isSnsUrl(undefined, 'eu-west-1')).toBe(false)
  })
})

describe('verifySnsSignature', () => {
  const { publicKey, privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 })
  const pem = publicKey.export({ type: 'spki', format: 'pem' }) as string
  const base: SnsMessage = {
    Type: 'Notification',
    MessageId: 'm1',
    TopicArn: TOPIC,
    Message: 'hello',
    Timestamp: '2026-11-17T10:00:00.000Z',
    SigningCertURL: 'https://sns.eu-west-1.amazonaws.com/c.pem',
  }
  const sign = (msg: SnsMessage, algorithm: string) =>
    createSign(algorithm).update(snsStringToSign(msg) as string, 'utf8').sign(privateKey, 'base64')

  it('builds the canonical string with and without a Subject', () => {
    expect(snsStringToSign(base)).toBe(
      `Message\nhello\nMessageId\nm1\nTimestamp\n2026-11-17T10:00:00.000Z\nTopicArn\n${TOPIC}\nType\nNotification\n`,
    )
    expect(snsStringToSign({ ...base, Subject: 's' })).toContain('Subject\ns\nTimestamp')
  })

  it('accepts a valid version 1 and version 2 signature', async () => {
    const getCert = async () => pem
    expect(await verifySnsSignature({ ...base, SignatureVersion: '1', Signature: sign(base, 'RSA-SHA1') }, 'eu-west-1', getCert)).toBe('valid')
    expect(await verifySnsSignature({ ...base, SignatureVersion: '2', Signature: sign(base, 'RSA-SHA256') }, 'eu-west-1', getCert)).toBe('valid')
  })

  it('refuses a changed message, a wrong version, a foreign certificate host and a missing signature', async () => {
    const getCert = vi.fn(async () => pem)
    const signed = { ...base, SignatureVersion: '2', Signature: sign(base, 'RSA-SHA256') }
    expect(await verifySnsSignature({ ...signed, Message: 'tampered' }, 'eu-west-1', getCert)).toBe('invalid')
    expect(await verifySnsSignature({ ...signed, SignatureVersion: '1' }, 'eu-west-1', getCert)).toBe('invalid')
    expect(await verifySnsSignature({ ...signed, SignatureVersion: '3' }, 'eu-west-1', getCert)).toBe('invalid')
    expect(await verifySnsSignature({ ...signed, Signature: undefined }, 'eu-west-1', getCert)).toBe('invalid')
    getCert.mockClear()
    expect(await verifySnsSignature({ ...signed, SigningCertURL: 'https://evil.example/c.pem' }, 'eu-west-1', getCert)).toBe('invalid')
    expect(getCert).not.toHaveBeenCalled()
  })

  it('reports unavailable, not invalid, when the certificate cannot be fetched', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const signed = { ...base, SignatureVersion: '2', Signature: sign(base, 'RSA-SHA256') }
    expect(await verifySnsSignature(signed, 'eu-west-1', async () => { throw new Error('down') })).toBe('unavailable')
  })
})
