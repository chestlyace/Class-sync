import { describe, expect, it } from 'vitest'
import { config, isPreviewDeployment } from './config'

describe('config', () => {
  it('has a time zone, defaulting to Africa/Douala', () => {
    expect(config.timeZone).toBe(process.env.APP_TIME_ZONE || 'Africa/Douala')
  })
})

describe('isPreviewDeployment', () => {
  it('is true only on a Vercel preview', () => {
    expect(isPreviewDeployment({ VERCEL_ENV: 'preview' })).toBe(true)
    expect(isPreviewDeployment({ VERCEL_ENV: 'production' })).toBe(false)
    expect(isPreviewDeployment({ VERCEL_ENV: 'development' })).toBe(false)
    expect(isPreviewDeployment({})).toBe(false)
  })
})
