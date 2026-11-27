import { describe, expect, it } from 'vitest'
import { claimClick, CLICK_COOLDOWN_MS, type ClickLike } from './idempotent-click'

const click: ClickLike = { button: 0, metaKey: false, ctrlKey: false, shiftKey: false, altKey: false }

describe('claimClick', () => {
  it('allows the first plain click and blocks another inside the cooldown', () => {
    const gate = { until: 0 }
    expect(claimClick(click, 1000, gate)).toBe(true)
    expect(gate.until).toBe(1000 + CLICK_COOLDOWN_MS)
    expect(claimClick(click, 1000 + CLICK_COOLDOWN_MS - 1, gate)).toBe(false)
  })

  it('allows a new click once the cooldown has passed', () => {
    const gate = { until: 0 }
    expect(claimClick(click, 1000, gate)).toBe(true)
    expect(claimClick(click, 1000 + CLICK_COOLDOWN_MS, gate)).toBe(true)
  })

  it('a blocked click does not extend the cooldown', () => {
    const gate = { until: 3000 }
    expect(claimClick(click, 2500, gate)).toBe(false)
    expect(gate.until).toBe(3000)
  })

  it('lets deliberate modifier and non-primary clicks through without consuming the gate', () => {
    const gate = { until: 3000 }
    const deliberate = [
      { ...click, button: 1 },
      { ...click, metaKey: true },
      { ...click, ctrlKey: true },
      { ...click, shiftKey: true },
      { ...click, altKey: true },
    ]
    for (const event of deliberate) expect(claimClick(event, 2500, gate)).toBe(true)
    expect(gate.until).toBe(3000)
  })
})
