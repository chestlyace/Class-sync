import { describe, expect, it } from 'vitest'
import { deployEnv, isHostedTestDeploy, isProductionDeploy } from './deploy-env'

describe('deployEnv', () => {
  it('reads APP_ENV first (Heroku)', () => {
    expect(deployEnv({ APP_ENV: 'production' })).toBe('production')
    expect(deployEnv({ APP_ENV: ' staging ' })).toBe('staging')
    expect(deployEnv({ APP_ENV: 'staging', VERCEL_ENV: 'production' })).toBe('staging')
  })

  it('falls back to Vercel: production, staging (Development previews) and other previews', () => {
    expect(deployEnv({ VERCEL_ENV: 'production' })).toBe('production')
    expect(deployEnv({ VERCEL_ENV: 'preview', VERCEL_GIT_COMMIT_REF: 'Development' })).toBe('staging')
    expect(deployEnv({ VERCEL_ENV: 'preview', VERCEL_GIT_COMMIT_REF: 'feat/x' })).toBe('preview')
    expect(deployEnv({ VERCEL_ENV: 'preview' })).toBe('preview')
  })

  it('is development otherwise, unknown APP_ENV values included', () => {
    expect(deployEnv({})).toBe('development')
    expect(deployEnv({ VERCEL_ENV: 'development' })).toBe('development')
    expect(deployEnv({ APP_ENV: 'prod' })).toBe('development')
  })

  it('names production and hosted test builds', () => {
    expect(isProductionDeploy({ APP_ENV: 'production' })).toBe(true)
    expect(isProductionDeploy({ APP_ENV: 'staging' })).toBe(false)
    expect(isHostedTestDeploy({ APP_ENV: 'staging' })).toBe(true)
    expect(isHostedTestDeploy({ VERCEL_ENV: 'preview' })).toBe(true)
    expect(isHostedTestDeploy({ APP_ENV: 'production' })).toBe(false)
    expect(isHostedTestDeploy({})).toBe(false)
  })
})
