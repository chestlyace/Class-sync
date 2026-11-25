import { describe, expect, it } from 'vitest'
import { RESET_RESEND_SECONDS } from '@/lib/password-reset'
import { formatWait } from '@/lib/format-wait'

describe('formatWait', () => {
  it('shows minutes and seconds the way a countdown reads', () => {
    expect(formatWait(RESET_RESEND_SECONDS)).toBe('2:00')
    expect(formatWait(65)).toBe('1:05')
    expect(formatWait(9)).toBe('0:09')
  })

  it('never shows a negative or fractional time', () => {
    expect(formatWait(-3)).toBe('0:00')
    expect(formatWait(0.2)).toBe('0:01')
  })
})
