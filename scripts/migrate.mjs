// Applies the migrations in drizzle/ (the same files and bookkeeping table as `drizzle-kit migrate`)
// with drizzle-orm's runtime migrator, so it runs where dev dependencies are pruned: Heroku's release
// phase (Procfile) runs it before each new version goes live, and a failure stops that release.
// TLS follows src/server/db/ssl.ts.
import { drizzle } from 'drizzle-orm/node-postgres'
import { migrate } from 'drizzle-orm/node-postgres/migrator'
import pg from 'pg'

const connectionString = process.env.DATABASE_URL
if (!connectionString) {
  console.error('DATABASE_URL is not set')
  process.exit(1)
}

const mode = process.env.DATABASE_SSL?.trim()
const ssl =
  /[?&]sslmode=/.test(connectionString) || mode === 'off'
    ? undefined
    : mode === 'no-verify' || process.env.DYNO
      ? { rejectUnauthorized: false }
      : undefined

const pool = new pg.Pool({ connectionString, ssl, max: 1 })
try {
  const started = Date.now()
  await migrate(drizzle(pool), { migrationsFolder: 'drizzle' })
  console.log(`Migrations applied (${Date.now() - started} ms)`)
} catch (error) {
  console.error('Migration failed', error)
  process.exitCode = 1
} finally {
  await pool.end()
}
