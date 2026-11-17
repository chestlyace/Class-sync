export type WhatsAppConfig = {
  region: string
  roleArn: string
  phoneNumberId: string
  displayNumber: string
  topicArn: string
  cap: number
}

const DEFAULT_CAP = 2000

/** Reads the AWS End User Messaging Social settings. Null when WhatsApp is not set up here (any required variable missing). */
export function whatsAppConfig(env: Record<string, string | undefined> = process.env): WhatsAppConfig | null {
  const region = env.WHATSAPP_AWS_REGION?.trim()
  const roleArn = env.WHATSAPP_AWS_ROLE_ARN?.trim()
  const phoneNumberId = env.WHATSAPP_PHONE_NUMBER_ID?.trim()
  const displayNumber = env.WHATSAPP_DISPLAY_NUMBER?.trim()
  const topicArn = env.WHATSAPP_SNS_TOPIC_ARN?.trim()
  if (!region || !roleArn || !phoneNumberId || !displayNumber || !topicArn) return null
  const parsed = Number(env.WHATSAPP_MONTHLY_CAP)
  const cap = Number.isInteger(parsed) && parsed > 0 ? parsed : DEFAULT_CAP
  return { region, roleArn, phoneNumberId, displayNumber, topicArn, cap }
}

/** Outside production, set WHATSAPP_ALLOWLIST (comma-separated E.164 numbers) so only those numbers get messages. Empty or unset allows everyone. */
export function isAllowedWhatsAppNumber(e164: string, env: Record<string, string | undefined> = process.env): boolean {
  const list = (env.WHATSAPP_ALLOWLIST ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
  return list.length === 0 || list.includes(e164)
}

/** Meta sends numbers as digits without the plus sign. Returns +digits, or null unless there are 8 to 15 digits. */
export function normalizePhone(raw: string): string | null {
  const digits = raw.trim().replace(/^\+/, '')
  return /^\d{8,15}$/.test(digits) ? `+${digits}` : null
}
