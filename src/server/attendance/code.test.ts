import { describe, expect, it } from 'vitest'
import { codeForSlot, currentCode, isCodeAccepted, newWindowSecret, slotAt } from './code'

const openedAt = new Date('2026-11-09T08:00:00Z')
const secret = 'test-secret'
const at = (s: number) => new Date(openedAt.getTime() + s * 1000)

describe('attendance code', () => {
  it('window secret is 64 hex characters and unique', () => {
    expect(newWindowSecret()).toMatch(/^[0-9a-f]{64}$/)
    expect(newWindowSecret()).not.toBe(newWindowSecret())
  })

  it('slotAt counts whole minutes since opening', () => {
    expect(slotAt(openedAt, at(0))).toBe(0)
    expect(slotAt(openedAt, at(59))).toBe(0)
    expect(slotAt(openedAt, at(60))).toBe(1)
    expect(slotAt(openedAt, at(125))).toBe(2)
  })

  it('code is 6 chars from the alphabet', () =>
    expect(codeForSlot(secret, 0)).toMatch(/^[A-HJ-NP-Z2-9]{6}$/))

  it('same code for a whole minute, new code after', () => {
    expect(currentCode(secret, openedAt, at(0)).code).toBe(currentCode(secret, openedAt, at(59)).code)
    expect(currentCode(secret, openedAt, at(60)).code).not.toBe(
      currentCode(secret, openedAt, at(59)).code,
    )
  })

  it('expiresInSeconds counts down within the slot', () =>
    expect(currentCode(secret, openedAt, at(45)).expiresInSeconds).toBe(15))

  it('accepts the previous code for 10 s after rotation', () => {
    const old = codeForSlot(secret, 0)
    expect(isCodeAccepted(secret, openedAt, at(65), old)).toBe(true)
    expect(isCodeAccepted(secret, openedAt, at(71), old)).toBe(false)
  })

  it('accepts the current code', () =>
    expect(isCodeAccepted(secret, openedAt, at(30), codeForSlot(secret, 0))).toBe(true))

  it('rejects a wrong code', () =>
    expect(isCodeAccepted(secret, openedAt, at(30), 'AAAAAA')).toBe(false))

  it('rejects a code two slots old', () =>
    expect(isCodeAccepted(secret, openedAt, at(125), codeForSlot(secret, 0))).toBe(false))

  it('accepts lowercase with a space', () => {
    const c = codeForSlot(secret, 0)
    expect(
      isCodeAccepted(secret, openedAt, at(5), `${c.slice(0, 3)} ${c.slice(3)}`.toLowerCase()),
    ).toBe(true)
  })

  it('different secrets give different codes', () =>
    expect(codeForSlot('a', 0)).not.toBe(codeForSlot('b', 0)))
})
