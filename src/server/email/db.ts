import { db as defaultDb, type Db } from '@/server/db'

let override: Db | null = null

/** Replaces the database the email code reads and records through, in tests. Pass null to restore the default. */
export function setEmailDbForTests(db: Db | null): void {
  override = db
}

/** The one place email code gets its database from (suspension checks and health events). */
export function emailDb(): Db {
  return override ?? defaultDb
}
