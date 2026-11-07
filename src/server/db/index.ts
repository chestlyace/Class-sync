import { attachDatabasePool } from '@vercel/functions'
import { drizzle } from 'drizzle-orm/node-postgres'
import type { PgDatabase } from 'drizzle-orm/pg-core'
import { Pool } from 'pg'
import * as schema from './schema'

// Structural type shared by the node-postgres client and the PGlite test client.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Db = PgDatabase<any, typeof schema>

// Cached on globalThis so dev hot reloads (which re-evaluate this module) reuse one pool.
const globalForDb = globalThis as typeof globalThis & { __clasyncDb?: Db }

function create(): Db {
  const connectionString = process.env.DATABASE_URL
  if (!connectionString) throw new Error('DATABASE_URL is not set')
  // Small pool: on Vercel Fluid Compute one instance serves many requests concurrently, and many
  // instances share the database's connection limit.
  const pool = new Pool({ connectionString, max: 5 })
  // Lets Fluid Compute keep the instance alive until idle clients are released, so suspended
  // instances don't leak connections. A no-op outside Vercel.
  attachDatabasePool(pool)
  // Without a listener, an error on an idle client (e.g. the server restarting)
  // is emitted as an unhandled 'error' event and crashes the process.
  pool.on('error', (err) => {
    console.error('[db] unexpected error on idle client', err)
  })
  return drizzle(pool, { schema })
}

function getInstance(): Db {
  return (globalForDb.__clasyncDb ??= create())
}

// Lazy: nothing connects (or throws) at import time, so tests and `next build`
// work without DATABASE_URL. The pool is created on first use.
export const db: Db = new Proxy({} as Db, {
  get(_target, prop) {
    // `await db` / returning db from an async function probes `.then`; answering
    // undefined keeps db from being mistaken for a thenable (and avoids creating a pool).
    if (prop === 'then') return undefined
    const instance = getInstance()
    const value = Reflect.get(instance, prop, instance)
    return typeof value === 'function' ? value.bind(instance) : value
  },
})
