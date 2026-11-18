import { createAmazonBedrock } from '@ai-sdk/amazon-bedrock'
import type { LanguageModel } from 'ai'
import type { AiConfig } from './config'

type Credentials = { accessKeyId: string; secretAccessKey: string; sessionToken?: string }

/**
 * Bedrock model signed in through Vercel's OIDC token exchange for an IAM role: no AWS keys are stored.
 * The provider itself is imported statically (it is light and the model must be returned synchronously);
 * the OIDC helper is imported on first use, so nothing loads unless a call is made.
 */
export function createBedrockModel(cfg: AiConfig): LanguageModel {
  const roleArn = cfg.roleArn
  if (!roleArn) throw new Error('AI_AWS_ROLE_ARN is not set')
  let provider: Promise<() => Promise<Credentials>> | undefined
  const credentialProvider = async () => {
    provider ??= import('@vercel/functions/oidc').then(({ awsCredentialsProvider }) => {
      const get = awsCredentialsProvider({ roleArn })
      return async () => {
        const c = await get()
        return { accessKeyId: c.accessKeyId, secretAccessKey: c.secretAccessKey, sessionToken: c.sessionToken }
      }
    })
    try {
      return await (await provider)()
    } catch (err) {
      // A failed import or credential fetch must not be cached forever: the next call retries.
      provider = undefined
      throw err
    }
  }
  return createAmazonBedrock({ region: cfg.region, credentialProvider })(cfg.assignmentModel)
}
