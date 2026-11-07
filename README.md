# Clasync

Clasync keeps a school's classes, courses and students in one place, in English and French.
Lecturers set up a shared class once and share a join code; students join with their matricule and see every course of their class.

## Stack

- [Next.js 16](https://nextjs.org) (App Router, Server Components, Server Actions), React 19, TypeScript
- PostgreSQL through [Drizzle ORM](https://orm.drizzle.team) on node-postgres; migrations in `drizzle/`
- [Better Auth](https://www.better-auth.com) (email and password, email verification)
- [next-intl](https://next-intl.dev) for English and French
- [shadcn/ui](https://ui.shadcn.com) on Tailwind CSS 4, Lucide icons
- [Resend](https://resend.com) with React Email for transactional email
- Vitest on [PGlite](https://pglite.dev) (in-process Postgres) for unit and service tests, Playwright for end to end

## Local setup

You need **Node 24** (npm 11) and a **local PostgreSQL** server.

1. Install dependencies:

   ```bash
   npm install
   ```

2. Create a database, e.g. `createdb clasync`.

3. Create `.env.local` (gitignored; `.env.example` lists every variable):

   ```bash
   DATABASE_URL=postgres://postgres@127.0.0.1:5432/clasync
   BETTER_AUTH_SECRET=<a long random string, e.g. openssl rand -hex 32>
   BETTER_AUTH_URL=http://localhost:3000
   # Leave email verification off until Resend is set up (see "Email verification" below).
   AUTH_REQUIRE_EMAIL_VERIFICATION=false
   ```

4. Apply the migrations. `drizzle-kit` reads `DATABASE_URL` from the shell, so pass it explicitly:

   ```bash
   DATABASE_URL=postgres://postgres@127.0.0.1:5432/clasync npm run db:migrate
   ```

5. Start the dev server and open <http://localhost:3000>:

   ```bash
   npm run dev
   ```

## Tests

```bash
npm test            # Vitest: unit and service tests, each file on a fresh in-memory PGlite database
npm run typecheck   # next typegen + tsc
npm run lint
```

End to end (Playwright builds the app and runs it with `next start`):

```bash
createdb clasync_e2e
DATABASE_URL=postgres://postgres@127.0.0.1:5432/clasync_e2e npm run db:migrate
E2E_DATABASE_URL=postgres://postgres@127.0.0.1:5432/clasync_e2e npm run e2e
```

`E2E_DATABASE_URL` must point at a throwaway database: the scenario creates users, schools, classes and courses.
Install the browser once with `./node_modules/.bin/playwright install chromium`.

## Project layout

```
src/server/        business logic, no UI
  schools/ classes/ courses/   services: take a Ctx (db + signed-in user), validate with Zod, throw AppError
  auth/            Better Auth config and session helpers
  core/            Ctx, AppError codes, guards (role, email verification), config
  db/              Drizzle client and schema (UI code may not import it; ESLint enforces this)
  email/           Resend sender and React Email templates
src/app/           routes: pages (Server Components) and Server Actions calling the services
  (app)/           signed-in area; (auth)/ sign-in, sign-up, verify-email
src/components/    shared UI (shadcn components in components/ui)
messages/          en.json and fr.json; a test keeps their keys identical
drizzle/           SQL migrations generated with drizzle-kit
e2e/               Playwright scenario
```

Server Actions wrap service calls in `toActionResult`, which turns an `AppError` into `{ ok: false, code }`; screens show `errors.<code>` from the message files.
Every user-facing string lives in both `messages/en.json` and `messages/fr.json`.

To change the schema, edit `src/server/db/schema/`, then run `./node_modules/.bin/drizzle-kit generate` to add a migration. Never edit a migration that has been applied.

## Email verification

Verification is **on by default**: new accounts must confirm their email before they can create or join anything, and an unverified user who signs in is sent a fresh link.

- Set `AUTH_REQUIRE_EMAIL_VERIFICATION=false` until Resend's sending domain is verified. Users can then work without confirming their email.
- Set `RESEND_API_KEY` (and optionally `EMAIL_FROM`) to send email. Without a key, local development logs the recipient, the subject and the verification link instead of sending.
- In production (`NODE_ENV=production`), sending without `RESEND_API_KEY` throws instead of silently dropping the email. Turn verification off, or set the key.

## Time zone

Session dates and check-in closing times are shown in one school time zone, set with `APP_TIME_ZONE`.
It defaults to `Africa/Douala` and must be a valid IANA zone name (e.g. `Africa/Lagos`, `Europe/Paris`); an invalid name makes the attendance screens fail to render.
Attendance rules themselves (15-minute check-ins, a session is over 12 hours after it starts) don't depend on it.

## Deploying

Run the migrations against the production database **before** deploying code that needs new tables or columns:

```bash
DATABASE_URL=<production connection string> npm run db:migrate
```

The new code fails on a database without its tables. Keep migrations additive (new tables, columns, indexes) so the version still running keeps working on the migrated database; a migration that drops or renames something needs a deploy in two steps.
