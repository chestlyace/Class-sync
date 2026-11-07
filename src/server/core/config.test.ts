import { describe, expect, it } from 'vitest'
import { config } from './config'

describe('config', () => {
  it('has a time zone, defaulting to Africa/Douala', () => {
    expect(config.timeZone).toBe(process.env.APP_TIME_ZONE || 'Africa/Douala')
  })
})
