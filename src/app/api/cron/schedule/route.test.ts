import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const enqueueToday = vi.fn()
vi.mock('@/server/schedule/default-db', () => ({ enqueueTodayDefault: (...args: unknown[]) => enqueueToday(...args) }))

const recordOpsEvent = vi.fn()
vi.mock('@/server/ops/events', () => ({ recordOpsEventDefault: (...args: unknown[]) => recordOpsEvent(...args) }))

import { GET, POST } from './route'

const url = 'http://localhost/api/cron/schedule'
const post = (headers: Record<string, string> = {}) => POST(new Request(url, { method: 'POST', headers }))
const get = (headers: Record<string, string> = {}) => GET(new Request(url, { method: 'GET', headers }))

describe('/api/cron/schedule', () => {
  beforeEach(() => {
    enqueueToday.mockReset().mockResolvedValue({ sittings: 4 })
    recordOpsEvent.mockReset().mockResolvedValue(undefined)
    vi.stubEnv('CRON_SECRET', 'right-secret')
  })
  afterEach(() => vi.unstubAllEnvs())

  it('rejects a missing or wrong bearer', async () => {
    expect((await post()).status).toBe(401)
    for (const bad of ['Bearer wrong-secret', 'Bearer right-secre', 'Bearer x', 'right-secret', 'Bearer ']) {
      expect((await get({ authorization: bad })).status).toBe(401)
    }
    expect(enqueueToday).not.toHaveBeenCalled()
    expect(recordOpsEvent).not.toHaveBeenCalled()
  })

  it('is 503 when CRON_SECRET is not configured', async () => {
    vi.stubEnv('CRON_SECRET', '')
    expect((await post({ authorization: 'Bearer ' })).status).toBe(503)
    expect(enqueueToday).not.toHaveBeenCalled()
  })

  it("enqueues today's sittings", async () => {
    const res = await get({ authorization: 'Bearer right-secret' })
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ sittings: 4 })
    expect(enqueueToday).toHaveBeenCalledTimes(1)
    expect(enqueueToday.mock.calls[0]![0]).toBeInstanceOf(Date)
    expect(recordOpsEvent).toHaveBeenCalledWith({ kind: 'cron_schedule', ok: true, detail: { sittings: 4 } })
  })

  it('answers the manual POST the same way', async () => {
    const res = await post({ authorization: 'Bearer right-secret' })
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ sittings: 4 })
  })

  it('records a failed run and returns 500 when loading the sittings throws', async () => {
    enqueueToday.mockRejectedValue(new Error('boom with right-secret detail'))
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const res = await get({ authorization: 'Bearer right-secret' })
    expect(res.status).toBe(500)
    expect(JSON.stringify(await res.json())).not.toContain('right-secret')
    expect(recordOpsEvent).toHaveBeenCalledTimes(1)
    expect(recordOpsEvent).toHaveBeenCalledWith({ kind: 'cron_schedule', ok: false, detail: { error: 'run failed' } })
  })
})
