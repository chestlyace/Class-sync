import { describe, expect, it } from 'vitest'
import { queueDriver } from './driver'

describe('queueDriver', () => {
  it('follows QUEUE_DRIVER when it names a driver', () => {
    expect(queueDriver({ QUEUE_DRIVER: 'pgboss', VERCEL: '1' })).toBe('pgboss')
    expect(queueDriver({ QUEUE_DRIVER: 'memory', DYNO: 'web.1' })).toBe('memory')
  })

  it('picks Vercel on Vercel, pg-boss on Heroku, memory elsewhere', () => {
    expect(queueDriver({ VERCEL: '1' })).toBe('vercel')
    expect(queueDriver({ DYNO: 'web.1' })).toBe('pgboss')
    expect(queueDriver({})).toBe('memory')
    expect(queueDriver({ QUEUE_DRIVER: 'redis' })).toBe('memory')
  })
})
