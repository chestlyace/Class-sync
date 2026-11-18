import { describe, expect, it } from 'vitest'
import { POLL_LIMIT_MS, pollOutcome } from './whatsapp-connect'

describe('pollOutcome', () => {
  it('keeps waiting before the limit when there is no number', () => {
    expect(pollOutcome({ phone: null, startedAt: 0, now: 5_000 })).toBe('waiting')
  })

  it('expires only once the limit has passed and there is still no number', () => {
    expect(pollOutcome({ phone: null, startedAt: 0, now: POLL_LIMIT_MS })).toBe('expired')
  })

  it('reports a connection even after the limit (a tab that slept while the user was in WhatsApp)', () => {
    expect(pollOutcome({ phone: '+237 6•• ••• 412', startedAt: 0, now: POLL_LIMIT_MS * 3 })).toBe('connected')
  })
})
