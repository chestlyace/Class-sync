import { isProductionDeploy } from '@/lib/deploy-env'

/** Claude Haiku 4.5 through Bedrock's EU cross-region inference profile (data stays in the EU). */
export const DEFAULT_ASSIGNMENT_MODEL = 'eu.anthropic.claude-haiku-4-5-20251001-v1:0'

/** Deterministic stand-in model id for local work and e2e; refused on Vercel production. */
export const FAKE_MODEL = 'fake'

const DEFAULT_REGION = 'eu-west-3'
const DEFAULT_MONTHLY_CAP = 3000

export type AiConfig = {
  /** IAM role Vercel's OIDC token is exchanged for (Vercel). Wins over an access key. */
  roleArn: string | null
  /**
   * An IAM user's access key (Heroku, which has no OIDC to AWS): the standard `AWS_ACCESS_KEY_ID` and
   * `AWS_SECRET_ACCESS_KEY`, shared with file storage. Null when either is missing.
   */
  accessKey: { accessKeyId: string; secretAccessKey: string } | null
  region: string
  assignmentModel: string
  monthlyCap: number
}

type Env = Record<string, string | undefined>

function text(value: string | undefined): string | null {
  const v = value?.trim()
  return v ? v : null
}

function accessKeyOf(env: Env): AiConfig['accessKey'] {
  const accessKeyId = text(env.AWS_ACCESS_KEY_ID)
  const secretAccessKey = text(env.AWS_SECRET_ACCESS_KEY)
  return accessKeyId && secretAccessKey ? { accessKeyId, secretAccessKey } : null
}

export function readAiConfig(env: Env = process.env): AiConfig {
  const cap = text(env.AI_MONTHLY_CAP)
  const parsedCap = cap && /^\d+$/.test(cap) ? Number(cap) : 0
  return {
    roleArn: text(env.AI_AWS_ROLE_ARN),
    accessKey: accessKeyOf(env),
    region: text(env.AI_AWS_REGION) ?? DEFAULT_REGION,
    assignmentModel: text(env.AI_ASSIGNMENT_MODEL) ?? DEFAULT_ASSIGNMENT_MODEL,
    monthlyCap: parsedCap > 0 ? parsedCap : DEFAULT_MONTHLY_CAP,
  }
}

/** Whether AI mark suggestions for assignments are available in this environment. */
export function isAssignmentMarkingOn(env: Env = process.env): boolean {
  const cfg = readAiConfig(env)
  if (cfg.assignmentModel === FAKE_MODEL) return !isProductionDeploy(env)
  return cfg.roleArn !== null || cfg.accessKey !== null
}
