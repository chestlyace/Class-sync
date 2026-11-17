import { afterEach, describe, expect, it } from 'vitest'
import { buildTemplatePayload } from './aws-provider'
import { setWhatsAppProviderForTests, whatsAppProvider, type WhatsAppProvider } from './provider'

describe('buildTemplatePayload', () => {
  it('builds a template message with a body and a URL button', () => {
    expect(
      buildTemplatePayload('+237612345678', {
        name: 'checkin_open',
        language: 'fr',
        bodyParams: ['Maths', 'Salle 4'],
        buttonPath: 'check-in',
      }),
    ).toEqual({
      messaging_product: 'whatsapp',
      to: '+237612345678',
      type: 'template',
      template: {
        name: 'checkin_open',
        language: { code: 'fr' },
        components: [
          {
            type: 'body',
            parameters: [
              { type: 'text', text: 'Maths' },
              { type: 'text', text: 'Salle 4' },
            ],
          },
          { type: 'button', sub_type: 'url', index: '0', parameters: [{ type: 'text', text: 'check-in' }] },
        ],
      },
    })
  })
})

describe('whatsAppProvider', () => {
  afterEach(() => setWhatsAppProviderForTests(null))

  it('is null without configuration', () => {
    expect(whatsAppProvider()).toBeNull()
  })

  it('returns the test override', () => {
    const fake: WhatsAppProvider = {
      sendTemplate: async () => ({ messageId: 't' }),
      sendText: async () => ({ messageId: 'x' }),
    }
    setWhatsAppProviderForTests(fake)
    expect(whatsAppProvider()).toBe(fake)
  })
})
