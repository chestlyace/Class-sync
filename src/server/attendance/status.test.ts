import { describe, expect, it } from 'vitest'
import { computeStatus, summarize } from './status'

const base = {
  startOpened: true,
  endOpened: true,
  checkedStart: false,
  checkedEnd: false,
  enrolled: true,
  override: null,
} as const

describe('computeStatus', () => {
  it('both checks is present', () =>
    expect(computeStatus({ ...base, checkedStart: true, checkedEnd: true })).toBe('present'))
  it('only start is partial', () =>
    expect(computeStatus({ ...base, checkedStart: true })).toBe('partial'))
  it('only end is partial', () =>
    expect(computeStatus({ ...base, checkedEnd: true })).toBe('partial'))
  it('no checks is absent', () => expect(computeStatus(base)).toBe('absent'))
  it('end window never opened: start alone is present', () =>
    expect(computeStatus({ ...base, endOpened: false, checkedStart: true })).toBe('present'))
  it('start window never opened: end alone is present', () =>
    expect(computeStatus({ ...base, startOpened: false, checkedEnd: true })).toBe('present'))
  it('no window opened is null', () =>
    expect(computeStatus({ ...base, startOpened: false, endOpened: false })).toBeNull())
  it('override applies when no window opened', () =>
    expect(
      computeStatus({ ...base, startOpened: false, endOpened: false, override: 'present' }),
    ).toBe('present'))
  it('not enrolled', () =>
    expect(computeStatus({ ...base, enrolled: false })).toBe('not_enrolled'))
  it('override beats not enrolled', () =>
    expect(computeStatus({ ...base, enrolled: false, override: 'absent' })).toBe('absent'))
  it('override beats checks', () =>
    expect(
      computeStatus({ ...base, checkedStart: true, checkedEnd: true, override: 'absent' }),
    ).toBe('absent'))
})

describe('summarize', () => {
  it('counts, ignoring null and not_enrolled', () =>
    expect(summarize(['present', 'partial', 'absent', null, 'not_enrolled', 'present'])).toEqual({
      present: 2,
      partial: 1,
      absent: 1,
    }))
})
