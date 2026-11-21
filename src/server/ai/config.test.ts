import { describe, expect, it } from 'vitest'
import { DEFAULT_ASSIGNMENT_MODEL, FAKE_MODEL, isAssignmentMarkingOn, readAiConfig } from './config'

describe('readAiConfig', () => {
  it('uses the defaults when nothing is set', () => {
    expect(readAiConfig({})).toEqual({
      roleArn: null,
      accessKey: null,
      region: 'eu-west-3',
      assignmentModel: DEFAULT_ASSIGNMENT_MODEL,
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
        AI_MONTHLY_CAP: '500',
      }),
    ).toEqual({
      roleArn: 'arn:aws:iam::123456789012:role/clasync-ai',
      accessKey: null,
      region: 'eu-central-1',
      assignmentModel: 'eu.anthropic.claude-sonnet-4-6',
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
