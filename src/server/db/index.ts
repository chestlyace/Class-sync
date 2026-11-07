import { drizzle } from 'drizzle-orm/node-postgres'
import type { PgDatabase } from 'drizzle-orm/pg-core'
import { Pool } from 'pg'
import * as schema from './schema'

// Structural type shared by the node-postgres client and the PGlite test client.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Db = PgDatabase<any, typeof schema>

let instance: Db | undefined

function create(): Db {
  const connectionString = process.env.DATABASE_URL
  if (!connectionString) throw new Error('DATABASE_URL is not set')
  return drizzle(new Pool({ connectionString }), { schema })
}

// Lazy: nothing connects (or throws) at import time, so tests and `next build`
// work without DATABASE_URL. The pool is created on first use.
export const db: Db = new Proxy({} as Db, {
  get(_target, prop) {
    instance ??= create()
    const value = Reflect.get(instance, prop, instance)
    return typeof value === 'function' ? value.bind(instance) : value
  },
})
