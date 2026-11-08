import { afterEach, describe, expect, it, vi } from 'vitest'
import { postJson } from './attempt-client'

afterEach(() => {
  vi.useRealTimers()
})

function respondWith(status: number, body: string): typeof fetch {
  return vi.fn(async () => new Response(body, { status, headers: { 'content-type': 'application/json' } }))
}

/** A fetch that never answers until its signal aborts (a stalled connection). */
const stalled: typeof fetch = (_url, init) =>
  new Promise((_resolve, reject) => {
    init?.signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')))
  })

describe('postJson', () => {
  it('posts the JSON body and returns the route result, ok or not', async () => {
    const fetchImpl = respondWith(200, JSON.stringify({ ok: true, data: { stage: 'answering' } }))
    expect(await postJson('/api/x', { a: 1 }, { fetchImpl })).toEqual({ ok: true, data: { stage: 'answering' } })
    const [url, init] = vi.mocked(fetchImpl).mock.calls[0]
    expect(url).toBe('/api/x')
    expect(init).toMatchObject({ method: 'POST', body: '{"a":1}', credentials: 'same-origin' })

    const conflict = { ok: false, code: 'CONFLICT', details: { reason: 'open_elsewhere' } }
    expect(await postJson('/api/x', {}, { fetchImpl: respondWith(409, JSON.stringify(conflict)) })).toEqual(conflict)
    expect(await postJson('/api/x', {}, { fetchImpl: respondWith(401, '{"ok":false,"code":"UNAUTHENTICATED"}') })).toEqual({
      ok: false,
      code: 'UNAUTHENTICATED',
    })
  })

  it('a server crash or a page that is not a result is failed', async () => {
    expect(await postJson('/api/x', {}, { fetchImpl: respondWith(500, '{"ok":false,"code":"INTERNAL"}') })).toEqual({
      ok: false,
      code: 'INTERNAL',
    })
    expect(await postJson('/api/x', {}, { fetchImpl: respondWith(502, '<html>Bad gateway</html>') })).toBe('failed')
    expect(await postJson('/api/x', {}, { fetchImpl: respondWith(200, '{"hello":1}') })).toBe('failed')
  })

  it('no connection is offline', async () => {
    const fetchImpl = vi.fn(async () => {
      throw new TypeError('Failed to fetch')
    })
    expect(await postJson('/api/x', {}, { fetchImpl })).toBe('offline')
  })

  it('a stalled request is aborted after the timeout and is offline, never left hanging', async () => {
    vi.useFakeTimers()
    const outcome = postJson('/api/x', {}, { fetchImpl: stalled, timeoutMs: 15_000 })
    await vi.advanceTimersByTimeAsync(14_999)
    let settled = false
    void outcome.then(() => (settled = true))
    await Promise.resolve()
    expect(settled).toBe(false)
    await vi.advanceTimersByTimeAsync(1)
    expect(await outcome).toBe('offline')
  })

  it('the caller can abort it (the runner went away)', async () => {
    const controller = new AbortController()
    const outcome = postJson('/api/x', {}, { fetchImpl: stalled, signal: controller.signal })
    controller.abort()
    expect(await outcome).toBe('offline')
  })
})
