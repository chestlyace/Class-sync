import { describe, expect, it } from 'vitest'
import { db } from './index'

describe('lazy db proxy', () => {
  it('can be awaited without creating a pool (no DATABASE_URL needed)', async () => {
    const saved = process.env.DATABASE_URL
    delete process.env.DATABASE_URL
    try {
      expect((db as unknown as { then?: unknown }).then).toBeUndefined()
      const resolved = await (async () => db)()
      expect(resolved).toBe(db)
    } finally {
      if (saved !== undefined) process.env.DATABASE_URL = saved
    }
  })

  it('throws a clear error on first real use without DATABASE_URL', () => {
    const saved = process.env.DATABASE_URL
    delete process.env.DATABASE_URL
    try {
      expect(() => db.select).toThrow('DATABASE_URL is not set')
    } finally {
      if (saved !== undefined) process.env.DATABASE_URL = saved
    }
  })
})
