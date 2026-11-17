import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { setSnsVerifierForTests } from '@/server/whatsapp/inbound'

vi.mock('@/server/db', async () => {
  const { createTestDb } = await import('@/test/db')
  return { db: await createTestDb() }
})

import { POST } from './route'

const TOPIC = 'arn:aws:sns:eu-west-1:1:t'
const body = (over: object = {}) =>
  JSON.stringify({ Type: 'Notification', TopicArn: TOPIC, Message: JSON.stringify({}), ...over })
const post = (text: string) => POST(new Request('http://localhost/api/whatsapp/events', { method: 'POST', body: text }))

beforeEach(() => {
  vi.stubEnv('WHATSAPP_AWS_REGION', 'eu-west-1')
  vi.stubEnv('WHATSAPP_AWS_ROLE_ARN', 'arn:aws:iam::1:role/x')
  vi.stubEnv('WHATSAPP_PHONE_NUMBER_ID', 'phone-number-id-1')
  vi.stubEnv('WHATSAPP_DISPLAY_NUMBER', '+1 555 010 0000')
  vi.stubEnv('WHATSAPP_SNS_TOPIC_ARN', TOPIC)
  setSnsVerifierForTests(async () => true)
})

afterEach(() => {
  vi.unstubAllEnvs()
  setSnsVerifierForTests(null)
})

describe('POST /api/whatsapp/events', () => {
  it('is 404 when WhatsApp is not set up', async () => {
    vi.stubEnv('WHATSAPP_SNS_TOPIC_ARN', '')
    expect((await post(body())).status).toBe(404)
  })

  it('is 403 for another topic', async () => {
    expect((await post(body({ TopicArn: 'arn:aws:sns:eu-west-1:2:other' }))).status).toBe(403)
  })

  it('is 403 when the signature does not verify', async () => {
    setSnsVerifierForTests(async () => false)
    expect((await post(body())).status).toBe(403)
  })

  it('is 200 for a verified notification', async () => {
    expect((await post(body())).status).toBe(200)
  })
})
