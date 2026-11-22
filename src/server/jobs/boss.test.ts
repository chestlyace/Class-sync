import { describe, expect, it } from 'vitest'
import { jobIdFor } from './boss'

describe('jobIdFor', () => {
  it('gives the same UUID for the same queue and key, a different one otherwise', () => {
    const a = jobIdFor('class-notices', 'k1')
    expect(a).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/)
    expect(jobIdFor('class-notices', 'k1')).toBe(a)
    expect(jobIdFor('class-notices', 'k2')).not.toBe(a)
    expect(jobIdFor('assignment-marking', 'k1')).not.toBe(a)
  })
})
