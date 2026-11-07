import { PGlite } from '@electric-sql/pglite'
import { drizzle } from 'drizzle-orm/pglite'
import { migrate } from 'drizzle-orm/pglite/migrator'
import path from 'node:path'
import type { Db } from '@/server/db'
import * as schema from '@/server/db/schema'

/** A fresh in-memory Postgres (PGlite) with all migrations applied. */
export async function createTestDb(): Promise<Db> {
  const client = new PGlite()
  const db = drizzle(client, { schema })
  await migrate(db, { migrationsFolder: path.resolve(process.cwd(), 'drizzle') })
  return db as unknown as Db
}
