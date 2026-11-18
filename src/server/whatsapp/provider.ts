import { createAwsProvider } from './aws-provider'
import { whatsAppConfig } from './config'

export type TemplateName =
  | 'checkin_open'
  | 'test_started'
  | 'results_released'
  | 'assignment_published'
  | 'class_soon_lecturer'

export type TemplateMessage = {
  name: TemplateName
  language: 'en' | 'fr'
  bodyParams: string[]
  /** Appended to the template's URL button base (for example `check-in`). */
  buttonPath: string
}

export type WhatsAppProvider = {
  sendTemplate(to: string, msg: TemplateMessage): Promise<{ messageId: string }>
  sendText(to: string, text: string): Promise<{ messageId: string }>
}

let testProvider: WhatsAppProvider | null = null
let realProvider: WhatsAppProvider | null = null

/** Replaces the provider in tests. Pass null to restore the real one. */
export function setWhatsAppProviderForTests(p: WhatsAppProvider | null): void {
  testProvider = p
}

/** The test override, else the AWS provider when configured, else null (WhatsApp is off). */
export function whatsAppProvider(): WhatsAppProvider | null {
  if (testProvider) return testProvider
  const config = whatsAppConfig()
  if (!config) return null
  realProvider ??= createAwsProvider(config)
  return realProvider
}
