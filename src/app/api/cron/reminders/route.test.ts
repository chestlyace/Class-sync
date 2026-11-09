import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const runDueReminders = vi.fn()
vi.mock('@/server/assignments/reminders', () => ({ runDueReminders: () => runDueReminders() }))
const pruneUnusedOauthClients = vi.fn()
vi.mock('@/server/mcp/prune', () => ({ pruneUnusedOauthClients: () => pruneUnusedOauthClients() }))
const pruneRateLimits = vi.fn()
vi.mock('@/server/lib/rate-limit', () => ({ pruneRateLimits: () => pruneRateLimits() }))

import { GET, POST } from './route'

const url = 'http://localhost/api/cron/reminders'
const post = (headers: Record<string, string> = {}) => POST(new Request(url, { method: 'POST', headers }))
const get = (headers: Record<string, string> = {}) => GET(new Request(url, { method: 'GET', headers }))

describe('POST /api/cron/reminders', () => {
  beforeEach(() => {
    runDueReminders.mockReset().mockResolvedValue({ assignments: 2, reminded: 5 })
    pruneUnusedOauthClients.mockReset().mockResolvedValue(3)
    pruneRateLimits.mockReset().mockResolvedValue(7)
    vi.stubEnv('CRON_SECRET', 'right-secret')
  })
  afterEach(() => vi.unstubAllEnvs())

  it('is 401 without an Authorization header', async () => {
    expect((await post()).status).toBe(401)
    expect(runDueReminders).not.toHaveBeenCalled()
  })

  it('is 401 for a wrong secret, whatever its length', async () => {
    for (const bad of ['Bearer wrong-secret', 'Bearer right-secre', 'Bearer x', 'right-secret', 'Bearer ']) {
      expect((await post({ authorization: bad })).status).toBe(401)
    }
    expect(runDueReminders).not.toHaveBeenCalled()
  })

  it('is 503 when CRON_SECRET is not configured, even for a matching empty header', async () => {
    vi.stubEnv('CRON_SECRET', '')
    expect((await post({ authorization: 'Bearer ' })).status).toBe(503)
    expect((await post({ authorization: 'Bearer right-secret' })).status).toBe(503)
    expect(runDueReminders).not.toHaveBeenCalled()
  })

  it('runs the job and returns the counts for the right secret', async () => {
    const res = await post({ authorization: 'Bearer right-secret' })
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ assignments: 2, reminded: 5, oauthClientsPruned: 3, rateLimitsPruned: 7 })
    expect(runDueReminders).toHaveBeenCalledTimes(1)
  })

  it('still sends reminders when pruning OAuth clients fails, and never prunes unauthenticated', async () => {
    pruneUnusedOauthClients.mockRejectedValue(new Error('db down'))
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const res = await post({ authorization: 'Bearer right-secret' })
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ assignments: 2, reminded: 5, oauthClientsPruned: null, rateLimitsPruned: 7 })
    pruneUnusedOauthClients.mockClear()
    await post({ authorization: 'Bearer wrong-secret' })
    expect(pruneUnusedOauthClients).not.toHaveBeenCalled()
  })

  it('does not echo the secret when the job fails', async () => {
    runDueReminders.mockRejectedValue(new Error('boom'))
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const res = await post({ authorization: 'Bearer right-secret' })
    expect(res.status).toBe(500)
    expect(JSON.stringify(await res.json())).not.toContain('right-secret')
  })
})

describe('GET /api/cron/reminders (Vercel Cron)', () => {
  beforeEach(() => {
    runDueReminders.mockReset().mockResolvedValue({ assignments: 2, reminded: 5 })
    pruneUnusedOauthClients.mockReset().mockResolvedValue(3)
    pruneRateLimits.mockReset().mockResolvedValue(7)
    vi.stubEnv('CRON_SECRET', 'right-secret')
  })
  afterEach(() => vi.unstubAllEnvs())

  it('runs the job and returns the counts for the right secret', async () => {
    const res = await get({ authorization: 'Bearer right-secret' })
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ assignments: 2, reminded: 5, oauthClientsPruned: 3, rateLimitsPruned: 7 })
    expect(runDueReminders).toHaveBeenCalledTimes(1)
  })

  it('is 401 without an Authorization header', async () => {
    expect((await get()).status).toBe(401)
    expect(runDueReminders).not.toHaveBeenCalled()
  })

  it('is 401 for a wrong secret', async () => {
    for (const bad of ['Bearer wrong-secret', 'Bearer right-secre', 'right-secret']) {
      expect((await get({ authorization: bad })).status).toBe(401)
    }
    expect(runDueReminders).not.toHaveBeenCalled()
  })

  it('is 503 when CRON_SECRET is not configured', async () => {
    vi.stubEnv('CRON_SECRET', '')
    expect((await get({ authorization: 'Bearer ' })).status).toBe(503)
    expect((await get({ authorization: 'Bearer right-secret' })).status).toBe(503)
    expect(runDueReminders).not.toHaveBeenCalled()
  })
})
