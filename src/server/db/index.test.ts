import { Pool } from 'pg'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { db } from './index'

const attachDatabasePool = vi.hoisted(() => vi.fn())
vi.mock('@vercel/functions', () => ({ attachDatabasePool }))

const globalForDb = globalThis as typeof globalThis & { __clasyncDb?: unknown }

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

describe('db pool', () => {
  afterEach(() => {
    delete globalForDb.__clasyncDb
    attachDatabasePool.mockClear()
  })

  it('is small (max 5) and attached to Vercel Fluid Compute, once, on first use', () => {
    const saved = process.env.DATABASE_URL
    process.env.DATABASE_URL = 'postgres://nobody@127.0.0.1:1/none' // a Pool does not connect until queried
    try {
      expect(attachDatabasePool).not.toHaveBeenCalled()
      void db.select
      void db.insert
      expect(attachDatabasePool).toHaveBeenCalledTimes(1)
      const pool = attachDatabasePool.mock.calls[0][0] as Pool
      expect(pool).toBeInstanceOf(Pool)
      expect(pool.options.max).toBe(5)
      expect(pool.options.connectionString).toBe('postgres://nobody@127.0.0.1:1/none')
    } finally {
      if (saved !== undefined) process.env.DATABASE_URL = saved
      else delete process.env.DATABASE_URL
    }
  })
})
