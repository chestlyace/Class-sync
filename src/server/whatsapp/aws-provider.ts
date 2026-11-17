import type { WhatsAppConfig } from './config'
import type { TemplateMessage, WhatsAppProvider } from './provider'

const META_API_VERSION = 'v20.0'

export function buildTemplatePayload(to: string, msg: TemplateMessage): object {
  return {
    messaging_product: 'whatsapp',
    to,
    type: 'template',
    template: {
      name: msg.name,
      language: { code: msg.language },
      components: [
        { type: 'body', parameters: msg.bodyParams.map((text) => ({ type: 'text', text })) },
        { type: 'button', sub_type: 'url', index: '0', parameters: [{ type: 'text', text: msg.buttonPath }] },
      ],
    },
  }
}

function buildTextPayload(to: string, body: string): object {
  return { messaging_product: 'whatsapp', to, type: 'text', text: { body } }
}

/** Sends through AWS End User Messaging Social, signing in with the Vercel OIDC token (no stored AWS keys). The SDK loads on the first send. */
export function createAwsProvider(config: WhatsAppConfig): WhatsAppProvider {
  let clientPromise: Promise<{
    send: (payload: object) => Promise<{ messageId: string }>
  }> | null = null

  function client() {
    clientPromise ??= (async () => {
      const [{ SocialMessagingClient, SendWhatsAppMessageCommand }, { awsCredentialsProvider }] = await Promise.all([
        import('@aws-sdk/client-socialmessaging'),
        import('@vercel/functions/oidc'),
      ])
      const sdk = new SocialMessagingClient({
        region: config.region,
        // A hung call must not eat the dispatcher's 60 s: fail fast and let the queue retry the event.
        requestHandler: { requestTimeout: 8000 },
        maxAttempts: 2,
        credentials: awsCredentialsProvider({ roleArn: config.roleArn }),
      })
      return {
        async send(payload: object) {
          const out = await sdk.send(
            new SendWhatsAppMessageCommand({
              originationPhoneNumberId: config.phoneNumberId,
              metaApiVersion: META_API_VERSION,
              message: new TextEncoder().encode(JSON.stringify(payload)),
            }),
          )
          if (!out.messageId) throw new Error('WhatsApp send returned no message id')
          return { messageId: out.messageId }
        },
      }
    })().catch((e) => {
      clientPromise = null
      throw e
    })
    return clientPromise
  }

  return {
    async sendTemplate(to, msg) {
      return (await client()).send(buildTemplatePayload(to, msg))
    },
    async sendText(to, text) {
      return (await client()).send(buildTextPayload(to, text))
    },
  }
}
