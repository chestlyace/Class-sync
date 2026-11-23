type Env = Record<string, string | undefined>

/**
 * TLS settings for the Postgres pool. Heroku Postgres requires TLS but signs its certificates
 * itself and its DATABASE_URL carries no `sslmode`, so on Heroku (DYNO is set) the connection is
 * encrypted without verifying the certificate, as Heroku documents. `DATABASE_SSL=no-verify` asks for
 * the same anywhere, `DATABASE_SSL=off` leaves it to the URL. An `sslmode` in the URL always wins.
 * Keep in step with scripts/migrate.mjs.
 */
export function poolSsl(connectionString: string, env: Env = process.env): { rejectUnauthorized: false } | undefined {
  const mode = env.DATABASE_SSL?.trim()
  if (/[?&]sslmode=/.test(connectionString) || mode === 'off') return undefined
  if (mode === 'no-verify' || env.DYNO) return { rejectUnauthorized: false }
  return undefined
}
