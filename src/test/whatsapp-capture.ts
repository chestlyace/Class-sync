import { vi } from 'vitest'
import { setAfterResponseForTests } from '@/server/lib/after-response'
import { setWhatsAppQueueForTests, type WhatsAppEvent } from '@/server/whatsapp/events'

export type CapturedWhatsApp = { event: WhatsAppEvent; deliverAt: Date }

/**
 * Configures WhatsApp (the enqueue is a no-op otherwise), captures queued events and runs after-response work on
 * demand. Call `flush()` after the action under test; call `stop()` in afterEach.
 */
export function captureWhatsApp(options: { configured?: boolean; failWith?: Error; ownAfterResponse?: boolean } = {}) {
  const { configured = true, failWith, ownAfterResponse = true } = options
  if (configured) {
    vi.stubEnv('WHATSAPP_AWS_REGION', 'eu-west-1')
    vi.stubEnv('WHATSAPP_AWS_ROLE_ARN', 'arn:aws:iam::1:role/x')
    vi.stubEnv('WHATSAPP_PHONE_NUMBER_ID', 'phone-number-id-1')
    vi.stubEnv('WHATSAPP_DISPLAY_NUMBER', '+237600000000')
    vi.stubEnv('WHATSAPP_SNS_TOPIC_ARN', 'arn:aws:sns:eu-west-1:1:topic')
  }
  const captured: CapturedWhatsApp[] = []
  const tasks: Promise<void>[] = []
  setWhatsAppQueueForTests({
    async send(event, deliverAt) {
      if (failWith) throw failWith
      captured.push({ event, deliverAt })
    },
  })
  // Pass ownAfterResponse: false when the test file already captures after-response work itself.
  if (ownAfterResponse) {
    setAfterResponseForTests((task) => {
      tasks.push(task())
    })
  }
  return {
    captured,
    async flush() {
      while (tasks.length) await Promise.all(tasks.splice(0))
    },
    stop() {
      setWhatsAppQueueForTests(null)
      if (ownAfterResponse) setAfterResponseForTests(null)
      vi.unstubAllEnvs()
    },
  }
}
