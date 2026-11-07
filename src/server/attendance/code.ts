import { createHmac, randomBytes } from 'node:crypto'
import { JOIN_CODE_ALPHABET, normalizeJoinCode } from '@/server/classes/join-code'
import { CODE_GRACE_SECONDS, CODE_TTL_SECONDS } from './rules'

const CODE_LENGTH = 6
const SLOT_MS = CODE_TTL_SECONDS * 1000

/** A fresh per-window secret: 32 random bytes, hex-encoded. */
export function newWindowSecret(): string {
  return randomBytes(32).toString('hex')
}

/** Which one-minute slot `at` falls in, counted from when the window opened. */
export function slotAt(openedAt: Date, at: Date): number {
  return Math.floor((at.getTime() - openedAt.getTime()) / SLOT_MS)
}

/** The 6-character code for a slot. 256 is divisible by 32, so `& 31` is unbiased. */
export function codeForSlot(secret: string, slot: number): string {
  const digest = createHmac('sha256', secret).update(String(slot)).digest()
  let code = ''
  for (let i = 0; i < CODE_LENGTH; i++) code += JOIN_CODE_ALPHABET[digest[i] & 31]
  return code
}

/** The code to show right now and how many seconds until it rotates. */
export function currentCode(
  secret: string,
  openedAt: Date,
  at: Date,
): { code: string; expiresInSeconds: number } {
  const slot = slotAt(openedAt, at)
  const intoSlotMs = at.getTime() - openedAt.getTime() - slot * SLOT_MS
  return {
    code: codeForSlot(secret, slot),
    expiresInSeconds: Math.ceil((SLOT_MS - intoSlotMs) / 1000),
  }
}

/** True when `input` is the current code, or the previous one within the grace period. */
export function isCodeAccepted(secret: string, openedAt: Date, at: Date, input: string): boolean {
  const code = normalizeJoinCode(input)
  const slot = slotAt(openedAt, at)
  if (code === codeForSlot(secret, slot)) return true
  const intoSlotMs = at.getTime() - openedAt.getTime() - slot * SLOT_MS
  return slot > 0 && intoSlotMs < CODE_GRACE_SECONDS * 1000 && code === codeForSlot(secret, slot - 1)
}
