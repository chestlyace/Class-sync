import { beforeEach, describe, expect, it, vi } from 'vitest'

const oidc = vi.hoisted(() => ({ awsCredentialsProvider: vi.fn() }))
vi.mock('@vercel/functions/oidc', () => oidc)
const bedrock = vi.hoisted(() => ({ opts: undefined as undefined | { credentialProvider: () => Promise<unknown> } }))
vi.mock('@ai-sdk/amazon-bedrock', () => ({
  createAmazonBedrock: (opts: { credentialProvider: () => Promise<unknown> }) => {
    bedrock.opts = opts
    return (modelId: string) => ({ modelId })
  },
}))

import { createBedrockModel } from './bedrock'
import { DEFAULT_ASSIGNMENT_MODEL, readAiConfig } from './config'

const roleArn = 'arn:aws:iam::123456789012:role/clasync-ai'

describe('createBedrockModel', () => {
  beforeEach(() => {
    oidc.awsCredentialsProvider.mockReset()
    bedrock.opts = undefined
  })

  it('builds the configured model without any credential lookup', () => {
    const model = createBedrockModel(readAiConfig({ AI_AWS_ROLE_ARN: roleArn }))
    expect((model as unknown as { modelId: string }).modelId).toBe(DEFAULT_ASSIGNMENT_MODEL)
    expect(oidc.awsCredentialsProvider).not.toHaveBeenCalled()
  })

  it('signs in with an access key when no role is set (Heroku), without OIDC', () => {
    const model = createBedrockModel(readAiConfig({ AWS_ACCESS_KEY_ID: 'AKIA1', AWS_SECRET_ACCESS_KEY: 'secret' }))
    expect((model as unknown as { modelId: string }).modelId).toBe(DEFAULT_ASSIGNMENT_MODEL)
    expect(bedrock.opts).toMatchObject({ region: 'eu-west-3', accessKeyId: 'AKIA1', secretAccessKey: 'secret' })
    expect(oidc.awsCredentialsProvider).not.toHaveBeenCalled()
  })

  it('builds another model when one is named (test marking)', () => {
    const cfg = readAiConfig({ AWS_ACCESS_KEY_ID: 'AKIA1', AWS_SECRET_ACCESS_KEY: 'secret' })
    const model = createBedrockModel(cfg, 'eu.anthropic.claude-haiku-5-5')
    expect((model as unknown as { modelId: string }).modelId).toBe('eu.anthropic.claude-haiku-5-5')
  })

  it('refuses to build a model without a role or an access key', () => {
    expect(() => createBedrockModel(readAiConfig({}))).toThrow(/AI_AWS_ROLE_ARN/)
  })

  it('adapts the OIDC credentials for the role and reuses the provider', async () => {
    const get = vi.fn().mockResolvedValue({ accessKeyId: 'AK', secretAccessKey: 'SK', sessionToken: 'ST', expiration: new Date() })
    oidc.awsCredentialsProvider.mockReturnValue(get)
    createBedrockModel(readAiConfig({ AI_AWS_ROLE_ARN: roleArn }))
    const creds = { accessKeyId: 'AK', secretAccessKey: 'SK', sessionToken: 'ST' }
    expect(await bedrock.opts!.credentialProvider()).toEqual(creds)
    expect(await bedrock.opts!.credentialProvider()).toEqual(creds)
    expect(oidc.awsCredentialsProvider).toHaveBeenCalledTimes(1)
    expect(oidc.awsCredentialsProvider).toHaveBeenCalledWith({ roleArn })
    expect(get).toHaveBeenCalledTimes(2)
  })

  it('retries after a failed credential fetch instead of caching the failure', async () => {
    const get = vi
      .fn()
      .mockRejectedValueOnce(new Error('sts down'))
      .mockResolvedValue({ accessKeyId: 'AK', secretAccessKey: 'SK' })
    oidc.awsCredentialsProvider.mockReturnValue(get)
    createBedrockModel(readAiConfig({ AI_AWS_ROLE_ARN: roleArn }))
    await expect(bedrock.opts!.credentialProvider()).rejects.toThrow('sts down')
    expect(await bedrock.opts!.credentialProvider()).toEqual({ accessKeyId: 'AK', secretAccessKey: 'SK', sessionToken: undefined })
    expect(oidc.awsCredentialsProvider).toHaveBeenCalledTimes(2)
  })
})

describe('OIDC peer dependency', () => {
  it('has @aws-sdk/credential-provider-web-identity installed (awsCredentialsProvider imports it on every fetch)', async () => {
    const mod = await vi.importActual<{ fromWebToken: unknown }>('@aws-sdk/credential-provider-web-identity')
    expect(typeof mod.fromWebToken).toBe('function')
  })
})
