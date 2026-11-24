import { SESv2Client } from '@aws-sdk/client-sesv2'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { broadcastSender, renderBroadcast, setBroadcastSenderForTests, type OutgoingBroadcast } from './sender'

const email: OutgoingBroadcast = {
  to: 'ada@example.com',
  subject: 'News',
  html: '<p>Hello</p>',
  text: 'Hello',
  unsubscribeUrl: 'https://clasync.test/api/unsubscribe/tok',
}

afterEach(() => {
  vi.restoreAllMocks()
  setBroadcastSenderForTests(null)
})

describe('broadcastSender', () => {
  it('is null in production without SES_REGION', () => {
    expect(broadcastSender({ APP_ENV: 'production' })).toBeNull()
  })

  it('logs instead of sending locally without SES_REGION', async () => {
    const info = vi.spyOn(console, 'info').mockImplementation(() => {})
    const sender = broadcastSender({})
    expect(sender?.kind).toBe('log')
    expect(await sender?.send(email)).toEqual({ ok: true })
    expect(info).toHaveBeenCalledTimes(1)
    const logged = JSON.stringify(info.mock.calls[0])
    expect(logged).toContain('a***@example.com')
    expect(logged).toContain('News')
    expect(logged).not.toContain('ada@example.com')
    expect(logged).not.toContain('Hello')
  })

  it('is SES when SES_REGION is set, also in production', () => {
    expect(broadcastSender({ APP_ENV: 'production', SES_REGION: 'eu-west-3' })?.kind).toBe('ses')
  })

  it('sends List-Unsubscribe headers through SES', async () => {
    const send = vi.spyOn(SESv2Client.prototype, 'send').mockImplementation(async () => ({}) as never)
    const sender = broadcastSender({ SES_REGION: 'eu-west-3', EMAIL_FROM: 'Clasync <noreply@clasync.online>' })
    expect(await sender?.send(email)).toEqual({ ok: true })
    expect(send).toHaveBeenCalledTimes(1)
    const input = (send.mock.calls[0]![0] as unknown as { input: Record<string, unknown> }).input
    expect(input).toMatchObject({
      FromEmailAddress: 'Clasync <noreply@clasync.online>',
      ReplyToAddresses: ['support@clasync.online'],
      Destination: { ToAddresses: ['ada@example.com'] },
      Content: {
        Simple: {
          Subject: { Data: 'News', Charset: 'UTF-8' },
          Body: { Html: { Data: '<p>Hello</p>', Charset: 'UTF-8' }, Text: { Data: 'Hello', Charset: 'UTF-8' } },
          Headers: [
            { Name: 'List-Unsubscribe', Value: '<https://clasync.test/api/unsubscribe/tok>' },
            { Name: 'List-Unsubscribe-Post', Value: 'List-Unsubscribe=One-Click' },
          ],
        },
      },
    })
  })

  it('returns ok:false with a scrubbed error when SES throws', async () => {
    vi.spyOn(SESv2Client.prototype, 'send').mockRejectedValue(new Error('Address ada@example.com is not verified'))
    const result = await broadcastSender({ SES_REGION: 'eu-west-3' })?.send(email)
    expect(result).toEqual({ ok: false, error: 'Address a***@example.com is not verified' })
  })

  it('uses the sender set for tests', () => {
    const fake = { kind: 'log' as const, send: async () => ({ ok: true as const }) }
    setBroadcastSenderForTests(fake)
    expect(broadcastSender({ APP_ENV: 'production' })).toBe(fake)
  })
})

describe('renderBroadcast', () => {
  it('builds one email with HTML, plain text and both unsubscribe addresses', async () => {
    const out = await renderBroadcast({
      locale: 'fr',
      subject: ' Nouveautes \n de novembre ',
      body: 'Bonjour\n\nVoir https://clasync.online/news',
      to: 'ada@example.com',
      unsubscribeUrl: 'https://clasync.test/api/unsubscribe/tok',
      unsubscribePageUrl: 'https://clasync.test/unsubscribe/tok',
    })
    expect(out.to).toBe('ada@example.com')
    expect(out.subject).toBe('Nouveautes de novembre')
    expect(out.unsubscribeUrl).toBe('https://clasync.test/api/unsubscribe/tok')
    expect(out.html).toContain('https://clasync.test/unsubscribe/tok')
    expect(out.html).toContain('Ne plus recevoir ces annonces')
    expect(out.text).toContain('https://clasync.test/unsubscribe/tok')
    expect(out.text).toContain('Bonjour')
  })
})
