import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it, vi } from 'vitest'

// public/sw.js is plain JavaScript run by the browser: load it here against a fake worker scope.
const SOURCE = readFileSync(path.join(process.cwd(), 'public', 'sw.js'), 'utf8')

type Handler = (event: Record<string, unknown>) => void

class FakeRequest {
  constructor(
    public url: string,
    public init?: RequestInit,
  ) {}
}

function loadWorker(opts: { caches?: string[]; addFails?: boolean; navigationPreload?: boolean } = {}) {
  const listeners = new Map<string, Handler>()
  const store = new Map<string, Map<string, Response>>((opts.caches ?? []).map((name) => [name, new Map()]))
  const caches = {
    open: vi.fn(async (name: string) => {
      if (!store.has(name)) store.set(name, new Map())
      return {
        add: vi.fn(async (request: FakeRequest) => {
          if (opts.addFails) throw new Error('offline')
          store.get(name)!.set(request.url, new Response('offline page'))
        }),
      }
    }),
    keys: async () => [...store.keys()],
    delete: vi.fn(async (name: string) => store.delete(name)),
    match: async (url: string) => {
      for (const cache of store.values()) if (cache.has(url)) return cache.get(url)!.clone()
      return undefined
    },
  }
  const navigationPreload = { enable: vi.fn(async () => undefined) }
  const self = {
    addEventListener: (name: string, fn: Handler) => listeners.set(name, fn),
    skipWaiting: vi.fn(async () => undefined),
    location: { origin: 'https://clasync.online' },
    clients: { claim: vi.fn(async () => undefined) },
    registration: {
      showNotification: vi.fn(async () => undefined),
      ...(opts.navigationPreload === false ? {} : { navigationPreload }),
    },
  }
  const fetch = vi.fn<(request: unknown) => Promise<Response>>(async () => new Response('network'))
  new Function('self', 'caches', 'fetch', 'Request', 'Response', SOURCE)(self, caches, fetch, FakeRequest, Response)

  /** Dispatches an event and waits for what it handed to waitUntil/respondWith. */
  async function dispatch(name: string, event: Record<string, unknown> = {}) {
    const waits: Promise<unknown>[] = []
    let responded = false
    listeners.get(name)!({
      ...event,
      waitUntil: (p: Promise<unknown>) => waits.push(p),
      respondWith: (p: Promise<unknown>) => {
        responded = true
        waits.push(p)
      },
    })
    const [first] = await Promise.all(waits)
    return { result: first, responded }
  }
  return { self, caches, store, fetch, navigationPreload, dispatch }
}

const pushEvent = (data: unknown) => ({ data: { json: () => data } })

describe('service worker: push', () => {
  it('renotifies a same-tag replacement, so it is not silent', async () => {
    const sw = loadWorker()
    await sw.dispatch('push', pushEvent({ title: 'Networking', body: 'Check-in is open.', url: '/check-in', tag: 'checkin-w1' }))
    expect(sw.self.registration.showNotification).toHaveBeenCalledWith(
      'Networking',
      expect.objectContaining({ tag: 'checkin-w1', renotify: true, data: { url: '/check-in' } }),
    )
  })

  it('never sets renotify without a tag (Chrome throws)', async () => {
    const sw = loadWorker()
    await sw.dispatch('push', pushEvent({ title: 'Clasync', body: 'x', url: '/settings' }))
    await sw.dispatch('push', pushEvent({ title: 'Clasync', body: 'x', url: '/settings', tag: '' }))
    for (const call of sw.self.registration.showNotification.mock.calls as unknown as [string, NotificationOptions & { renotify: boolean }][]) {
      expect(call[1].tag).toBeUndefined()
      expect(call[1].renotify).toBe(false)
    }
  })
})

describe('service worker: activate', () => {
  it('deletes older caches, caches /offline again and enables navigation preload', async () => {
    const sw = loadWorker({ caches: ['clasync-offline-v1', 'something-else'] })
    await sw.dispatch('activate')
    expect([...sw.store.keys()]).toEqual(['clasync-offline-v2'])
    expect(sw.store.get('clasync-offline-v2')!.has('/offline')).toBe(true)
    expect(sw.navigationPreload.enable).toHaveBeenCalled()
    expect(sw.self.clients.claim).toHaveBeenCalled()
  })

  it('still takes control when /offline cannot be fetched or preload is missing', async () => {
    const sw = loadWorker({ addFails: true, navigationPreload: false })
    await expect(sw.dispatch('activate')).resolves.toBeDefined()
    expect(sw.self.clients.claim).toHaveBeenCalled()
  })
})

describe('service worker: page loads', () => {
  const navigate = (preloadResponse: Promise<Response | undefined>) => ({
    request: { mode: 'navigate', url: 'https://clasync.online/dashboard' },
    preloadResponse,
  })

  it('uses the preloaded response when there is one', async () => {
    const sw = loadWorker()
    const preloaded = new Response('preloaded')
    const { result } = await sw.dispatch('fetch', navigate(Promise.resolve(preloaded)))
    expect(result).toBe(preloaded)
    expect(sw.fetch).not.toHaveBeenCalled()
  })

  it('goes to the network without a preload, and to /offline when that fails', async () => {
    const sw = loadWorker()
    await sw.dispatch('install')
    const online = await sw.dispatch('fetch', navigate(Promise.resolve(undefined)))
    expect(await (online.result as Response).text()).toBe('network')

    sw.fetch.mockRejectedValueOnce(new TypeError('Failed to fetch'))
    const offline = await sw.dispatch('fetch', navigate(Promise.resolve(undefined)))
    expect(await (offline.result as Response).text()).toBe('offline page')

    // A failed preload falls back the same way.
    const failedPreload = await sw.dispatch('fetch', navigate(Promise.reject(new TypeError('Failed to fetch'))))
    expect(await (failedPreload.result as Response).text()).toBe('offline page')
  })

  it('leaves other requests alone', async () => {
    const sw = loadWorker()
    const { responded } = await sw.dispatch('fetch', { request: { mode: 'cors', url: 'https://clasync.online/api/x' } })
    expect(responded).toBe(false)
  })
})
