import { describe, expect, it } from 'vitest'
import { DEFAULT_ASSIGNMENT_MODEL, FAKE_MODEL, isAssignmentMarkingOn, isTestMarkingOn, readAiConfig } from './config'

describe('readAiConfig', () => {
  it('uses the defaults when nothing is set', () => {
    expect(readAiConfig({})).toEqual({
      roleArn: null,
      accessKey: null,
      region: 'eu-west-3',
      assignmentModel: DEFAULT_ASSIGNMENT_MODEL,
      testModel: DEFAULT_ASSIGNMENT_MODEL,
      monthlyCap: 3000,
    })
    expect(DEFAULT_ASSIGNMENT_MODEL).toBe('eu.anthropic.claude-haiku-4-5-20251001-v1:0')
  })

  it('reads overrides', () => {
    expect(
      readAiConfig({
        AI_AWS_ROLE_ARN: 'arn:aws:iam::123456789012:role/clasync-ai',
        AI_AWS_REGION: 'eu-central-1',
        AI_ASSIGNMENT_MODEL: 'eu.anthropic.claude-sonnet-4-6',
        AI_MARKING_MODEL: 'eu.anthropic.claude-haiku-5-5',
        AI_MONTHLY_CAP: '500',
      }),
    ).toEqual({
      roleArn: 'arn:aws:iam::123456789012:role/clasync-ai',
      accessKey: null,
      region: 'eu-central-1',
      assignmentModel: 'eu.anthropic.claude-sonnet-4-6',
      testModel: 'eu.anthropic.claude-haiku-5-5',
      monthlyCap: 500,
    })
  })

  it('reads an access key only when both halves are set', () => {
    expect(readAiConfig({ AWS_ACCESS_KEY_ID: 'AKIA1', AWS_SECRET_ACCESS_KEY: 'secret' }).accessKey).toEqual({
      accessKeyId: 'AKIA1',
      secretAccessKey: 'secret',
    })
    expect(readAiConfig({ AWS_ACCESS_KEY_ID: 'AKIA1' }).accessKey).toBeNull()
    expect(readAiConfig({ AWS_ACCESS_KEY_ID: 'AKIA1', AWS_SECRET_ACCESS_KEY: 'secret', VERCEL: '1' }).accessKey).toBeNull()
    expect(readAiConfig({ AWS_ACCESS_KEY_ID: ' ', AWS_SECRET_ACCESS_KEY: 'secret' }).accessKey).toBeNull()
  })

  it('treats blank values as unset and an invalid cap as the default', () => {
    for (const bad of ['', '0', '-5', 'abc', '1.5', ' ']) {
      expect(readAiConfig({ AI_MONTHLY_CAP: bad }).monthlyCap).toBe(3000)
    }
    const cfg = readAiConfig({ AI_AWS_ROLE_ARN: ' ', AI_AWS_REGION: '', AI_ASSIGNMENT_MODEL: ' ' })
    expect(cfg.roleArn).toBeNull()
    expect(cfg.region).toBe('eu-west-3')
    expect(cfg.assignmentModel).toBe(DEFAULT_ASSIGNMENT_MODEL)
  })
})

describe('readAiConfig testModel (AI_MARKING_MODEL)', () => {
  it.each([
    ['unset', undefined, DEFAULT_ASSIGNMENT_MODEL],
    ['blank', ' ', DEFAULT_ASSIGNMENT_MODEL],
    ['a leftover AI Gateway name', 'openai/gpt-5-mini', DEFAULT_ASSIGNMENT_MODEL],
    ['another Gateway name', 'anthropic/claude-haiku-4.5', DEFAULT_ASSIGNMENT_MODEL],
    ['a Bedrock inference profile', 'eu.anthropic.claude-haiku-5-5', 'eu.anthropic.claude-haiku-5-5'],
    [
      'a Bedrock ARN',
      'arn:aws:bedrock:eu-west-3:123456789012:inference-profile/eu.anthropic.claude-haiku-4-5-20251001-v1:0',
      'arn:aws:bedrock:eu-west-3:123456789012:inference-profile/eu.anthropic.claude-haiku-4-5-20251001-v1:0',
    ],
    ['the fake', FAKE_MODEL, FAKE_MODEL],
  ] as const)('%s', (_name, value, expected) => {
    expect(readAiConfig(value === undefined ? {} : { AI_MARKING_MODEL: value }).testModel).toBe(expected)
  })
})

describe('isTestMarkingOn', () => {
  it.each([
    ['nothing set', {}, false],
    ['access key set (Heroku)', { AWS_ACCESS_KEY_ID: 'AKIA1', AWS_SECRET_ACCESS_KEY: 'secret', APP_ENV: 'production' }, true],
    ['role set (Vercel)', { AI_AWS_ROLE_ARN: 'arn:aws:iam::123456789012:role/clasync-ai', VERCEL_ENV: 'production' }, true],
    ['a leftover Gateway name without credentials', { AI_MARKING_MODEL: 'openai/gpt-5-mini' }, false],
    ['fake model locally', { AI_MARKING_MODEL: FAKE_MODEL }, true],
    ['fake model on Heroku production', { AI_MARKING_MODEL: FAKE_MODEL, APP_ENV: 'production' }, false],
    // The assignment switch does not turn test marking on, nor the other way round.
    ['only the assignment model is fake', { AI_ASSIGNMENT_MODEL: FAKE_MODEL }, false],
  ] as const)('%s', (_name, env, expected) => {
    expect(isTestMarkingOn(env as Record<string, string>)).toBe(expected)
  })
})

describe('isAssignmentMarkingOn', () => {
  const role = 'arn:aws:iam::123456789012:role/clasync-ai'
  it.each([
    ['fake model outside production', { AI_ASSIGNMENT_MODEL: FAKE_MODEL, VERCEL_ENV: 'preview' }, true],
    ['fake model with no VERCEL_ENV (local)', { AI_ASSIGNMENT_MODEL: FAKE_MODEL }, true],
    ['fake model in production', { AI_ASSIGNMENT_MODEL: FAKE_MODEL, VERCEL_ENV: 'production' }, false],
    ['fake model in production even with a role', { AI_ASSIGNMENT_MODEL: FAKE_MODEL, AI_AWS_ROLE_ARN: role, VERCEL_ENV: 'production' }, false],
    ['role set, default model', { AI_AWS_ROLE_ARN: role, VERCEL_ENV: 'production' }, true],
    ['access key set (Heroku)', { AWS_ACCESS_KEY_ID: 'AKIA1', AWS_SECRET_ACCESS_KEY: 'secret', APP_ENV: 'production' }, true],
    ['half an access key', { AWS_ACCESS_KEY_ID: 'AKIA1', APP_ENV: 'production' }, false],
    ['fake model on Heroku production', { AI_ASSIGNMENT_MODEL: FAKE_MODEL, APP_ENV: 'production' }, false],
    ['role set, explicit real model', { AI_AWS_ROLE_ARN: role, AI_ASSIGNMENT_MODEL: 'eu.anthropic.claude-sonnet-4-6' }, true],
    ['nothing set', {}, false],
    ['real model without a role', { AI_ASSIGNMENT_MODEL: 'eu.anthropic.claude-sonnet-4-6' }, false],
  ] as const)('%s', (_name, env, expected) => {
    expect(isAssignmentMarkingOn(env as Record<string, string>)).toBe(expected)
  })
})
