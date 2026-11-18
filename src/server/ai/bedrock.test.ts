import { describe, expect, it } from 'vitest'
import { createBedrockModel } from './bedrock'
import { DEFAULT_ASSIGNMENT_MODEL, readAiConfig } from './config'

describe('createBedrockModel', () => {
  it('builds the configured model without any network or credential lookup', () => {
    const cfg = readAiConfig({ AI_AWS_ROLE_ARN: 'arn:aws:iam::123456789012:role/clasync-ai' })
    const model = createBedrockModel(cfg)
    expect(typeof model).toBe('object')
    expect((model as { modelId: string }).modelId).toBe(DEFAULT_ASSIGNMENT_MODEL)
  })

  it('refuses to build a model without a role', () => {
    expect(() => createBedrockModel(readAiConfig({}))).toThrow(/AI_AWS_ROLE_ARN/)
  })
})
