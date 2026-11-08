import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DEVICE_KEY, getDeviceId, randomUuid } from './device-id'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/

function memoryStorage(): Storage {
  const map = new Map<string, string>()
  return {
    get length() {
      return map.size
    },
    clear: () => map.clear(),
    getItem: (k) => (map.has(k) ? map.get(k)! : null),
    key: (i) => [...map.keys()][i] ?? null,
    removeItem: (k) => void map.delete(k),
    setItem: (k, v) => void map.set(k, String(v)),
  }
}

let storage: Storage
beforeEach(() => {
  storage = memoryStorage()
  vi.stubGlobal('localStorage', storage)
})
afterEach(() => {
  vi.unstubAllGlobals()
})

describe('getDeviceId', () => {
  it('creates a UUID once and keeps it in localStorage', () => {
    const id = getDeviceId()
    expect(id).toMatch(UUID)
    expect(JSON.parse(storage.getItem(DEVICE_KEY)!)).toBe(id)
    expect(getDeviceId()).toBe(id)
  })

  it('reads an id already stored', () => {
    storage.setItem(DEVICE_KEY, JSON.stringify('44444444-4444-4444-8444-444444444444'))
    expect(getDeviceId()).toBe('44444444-4444-4444-8444-444444444444')
  })

  it('replaces junk in storage with a fresh UUID', () => {
    storage.setItem(DEVICE_KEY, '"not-a-uuid"')
    const id = getDeviceId()
    expect(id).toMatch(UUID)
    expect(JSON.parse(storage.getItem(DEVICE_KEY)!)).toBe(id)
  })

  it('without storage, keeps one id in memory for the page', () => {
    vi.stubGlobal('localStorage', undefined)
    const id = getDeviceId()
    expect(id).toMatch(UUID)
    expect(getDeviceId()).toBe(id)
  })
})

describe('randomUuid', () => {
  it('makes v4 UUIDs, also where crypto.randomUUID is missing (plain http)', () => {
    expect(randomUuid()).toMatch(UUID)
    vi.stubGlobal('crypto', { getRandomValues: globalThis.crypto.getRandomValues.bind(globalThis.crypto) })
    const a = randomUuid()
    expect(a).toMatch(UUID)
    expect(randomUuid()).not.toBe(a)
  })
})
