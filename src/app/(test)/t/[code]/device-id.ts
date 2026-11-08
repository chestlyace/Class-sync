import { loadDraft, saveDraft } from '@/lib/draft-store'

/**
 * This browser's id, sent with every sync so the server can tell one device from another (only one
 * may answer an attempt at a time). Kept in localStorage; without storage (blocked, some private
 * modes) it lives in memory for the page's lifetime.
 */
export const DEVICE_KEY = 'clasync:device'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

let memoryId: string | null = null

/** A v4 UUID. `crypto.randomUUID` exists only on https (and localhost); a phone on plain http over the LAN has only `getRandomValues`. */
export function randomUuid(): string {
  if (typeof globalThis.crypto?.randomUUID === 'function') return globalThis.crypto.randomUUID()
  const bytes = globalThis.crypto.getRandomValues(new Uint8Array(16))
  bytes[6] = (bytes[6] & 0x0f) | 0x40 // version 4
  bytes[8] = (bytes[8] & 0x3f) | 0x80 // RFC variant
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}

export function getDeviceId(): string {
  const stored = loadDraft(DEVICE_KEY)
  if (typeof stored === 'string' && UUID.test(stored)) return stored
  memoryId ??= randomUuid()
  saveDraft(DEVICE_KEY, memoryId)
  return memoryId
}
