import { isHostedTestDeploy } from '@/lib/deploy-env'

type Env = Record<string, string | undefined>

export type WhatsAppConfig = {
  region: string
  /** IAM role Vercel's OIDC token is exchanged for (Vercel only). Wins over an access key. */
  roleArn: string | null
  /**
   * An IAM user's access key (Heroku, which has no OIDC to AWS): the standard `AWS_ACCESS_KEY_ID` and
   * `AWS_SECRET_ACCESS_KEY`, shared with file storage and Bedrock. Null when either is missing.
   */
  accessKey: { accessKeyId: string; secretAccessKey: string } | null
  phoneNumberId: string
  displayNumber: string
  topicArn: string
  cap: number
}

const DEFAULT_CAP = 2000

function text(value: string | undefined): string | null {
  const v = value?.trim()
  return v ? v : null
}

function accessKeyOf(env: Env): WhatsAppConfig['accessKey'] {
  // Vercel's own runtime may carry AWS variables of its own: there, only the OIDC role counts.
  if (env.VERCEL) return null
  const accessKeyId = text(env.AWS_ACCESS_KEY_ID)
  const secretAccessKey = text(env.AWS_SECRET_ACCESS_KEY)
  return accessKeyId && secretAccessKey ? { accessKeyId, secretAccessKey } : null
}

/**
 * Reads the AWS End User Messaging Social settings. Null when WhatsApp is off here: on staging or a preview
 * (APP_ENV), when a required variable is missing (region, phone number ID, display number, SNS topic ARN),
 * or when there is no way to sign in to AWS (an access key, or a role on Vercel).
 */
export function whatsAppConfig(env: Env = process.env): WhatsAppConfig | null {
  if (isHostedTestDeploy(env)) return null
  const region = text(env.WHATSAPP_AWS_REGION)
  const phoneNumberId = text(env.WHATSAPP_PHONE_NUMBER_ID)
  const displayNumber = text(env.WHATSAPP_DISPLAY_NUMBER)
  const topicArn = text(env.WHATSAPP_SNS_TOPIC_ARN)
  if (!region || !phoneNumberId || !displayNumber || !topicArn) return null
  const roleArn = text(env.WHATSAPP_AWS_ROLE_ARN)
  const accessKey = accessKeyOf(env)
  if (!roleArn && !accessKey) return null
  const parsed = Number(env.WHATSAPP_MONTHLY_CAP)
  const cap = Number.isInteger(parsed) && parsed > 0 ? parsed : DEFAULT_CAP
  return { region, roleArn, accessKey, phoneNumberId, displayNumber, topicArn, cap }
}

/** When WHATSAPP_ALLOWLIST (comma-separated E.164 numbers) is non-empty, in any environment, only those numbers get messages: the rollout list. Empty or unset allows everyone. */
export function isAllowedWhatsAppNumber(e164: string, env: Env = process.env): boolean {
  const entries = (env.WHATSAPP_ALLOWLIST ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
  if (entries.length === 0) return true
  const number = normalizePhone(e164)
  if (!number) return false
  return entries.some((entry) => normalizePhone(entry) === number)
}

/** Meta sends numbers as digits without the plus sign. Returns +digits, or null unless there are 8 to 15 digits. */
export function normalizePhone(raw: string): string | null {
  const digits = raw.trim().replace(/^\+/, '')
  return /^\d{8,15}$/.test(digits) ? `+${digits}` : null
}
