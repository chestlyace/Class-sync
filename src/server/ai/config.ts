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
  /** Model for test short-answer suggestions (`AI_MARKING_MODEL`); "fake" for the deterministic stand-in. */
  testModel: string
  monthlyCap: number
}

type Env = Record<string, string | undefined>

function text(value: string | undefined): string | null {
  const v = value?.trim()
  return v ? v : null
}

function accessKeyOf(env: Env): AiConfig['accessKey'] {
  // Vercel's own runtime may carry AWS variables of its own: there, only the OIDC role counts.
  if (env.VERCEL) return null
  const accessKeyId = text(env.AWS_ACCESS_KEY_ID)
  const secretAccessKey = text(env.AWS_SECRET_ACCESS_KEY)
  return accessKeyId && secretAccessKey ? { accessKeyId, secretAccessKey } : null
}

/**
 * `AI_MARKING_MODEL` used to name an AI Gateway "provider/model" (openai/gpt-5-mini): Bedrock can't run that,
 * so such a value falls back to the default. Bedrock ids and ARNs never start with "word/".
 */
function testModelOf(env: Env): string {
  const model = text(env.AI_MARKING_MODEL)
  return model && !/^[\w-]+\//.test(model) ? model : DEFAULT_ASSIGNMENT_MODEL
}

export function readAiConfig(env: Env = process.env): AiConfig {
  const cap = text(env.AI_MONTHLY_CAP)
  const parsedCap = cap && /^\d+$/.test(cap) ? Number(cap) : 0
  return {
    roleArn: text(env.AI_AWS_ROLE_ARN),
    accessKey: accessKeyOf(env),
    region: text(env.AI_AWS_REGION) ?? DEFAULT_REGION,
    assignmentModel: text(env.AI_ASSIGNMENT_MODEL) ?? DEFAULT_ASSIGNMENT_MODEL,
    testModel: testModelOf(env),
    monthlyCap: parsedCap > 0 ? parsedCap : DEFAULT_MONTHLY_CAP,
  }
}

/** A model is usable when it is the fake (never in production) or Bedrock credentials are set. */
function isModelOn(model: string, cfg: AiConfig, env: Env): boolean {
  if (model === FAKE_MODEL) return !isProductionDeploy(env)
  return cfg.roleArn !== null || cfg.accessKey !== null
}

/** Whether AI mark suggestions for assignments are available in this environment. */
export function isAssignmentMarkingOn(env: Env = process.env): boolean {
  const cfg = readAiConfig(env)
  return isModelOn(cfg.assignmentModel, cfg, env)
}

/** Whether AI mark suggestions for test short answers are available in this environment. */
export function isTestMarkingOn(env: Env = process.env): boolean {
  const cfg = readAiConfig(env)
  return isModelOn(cfg.testModel, cfg, env)
}
