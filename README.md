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

## File storage

Assignment attachments and submitted files (PDF, Word, images; 20 MB each, 10 per hand-in) go to [Vercel Blob](https://vercel.com/docs/vercel-blob) in production and to a local folder in development and end-to-end tests.

1. In the Vercel project, open Storage, create a **Blob** store and choose **Private** access. A public store would let anyone with a file's URL read students' work; Clasync never hands out Blob URLs and reads every file through `GET /api/files/<id>`, which checks access on each request.
2. Connect the store to the project (Production, and Preview if you test there). Vercel then sets `BLOB_READ_WRITE_TOKEN`; redeploy so the functions see it.
3. Leave `STORAGE_DRIVER` unset in production: with the token present the app uses Blob. Set `STORAGE_DRIVER=local` only for local runs (files go to `LOCAL_UPLOAD_DIR`, default `.uploads/`).

Downloads stream through the `/api/files/<id>` function, which may run for up to 5 minutes (`maxDuration = 300`; check that the Vercel plan allows that duration). A very large file on a slow connection can still hit that limit and stop part way; the browser then shows a failed download and the student or lecturer retries.

## Reminders (Vercel Cron)

A Vercel Cron job calls `GET /api/cron/reminders` once a day at 06:00 UTC, which is 07:00 in Douala (the schedule is in `vercel.json`). The Hobby plan allows one cron run per day.
Each run emails, once, every student who has not submitted work that is due in the next 24 hours.

1. Set `CRON_SECRET` to a long random string (e.g. `openssl rand -hex 32`) in the Vercel project: Settings, Environment Variables, add `CRON_SECRET` for Production, then redeploy. Vercel then sends it to the route as `Authorization: Bearer <CRON_SECRET>` on every cron call. Without it the route answers 503.
2. To run it by hand (replace `<domain>`):

   ```bash
   curl -X POST -H "Authorization: Bearer $CRON_SECRET" https://<domain>/api/cron/reminders
   ```

The response is JSON like `{"assignments":2,"reminded":14}`; `reminded` counts emails attempted, not confirmed deliveries. The links in the emails use `BETTER_AUTH_URL`.

An assignment published less than 24 hours before it is due is inside the reminder window at once, so its students may get the reminder soon after the "new assignment" email. When a lecturer moves the due date later, the reminders already sent for that assignment are forgotten and the new deadline gets its own reminder.

## Admin

A signed-in user is an admin when their email is listed in `ADMIN_EMAILS` (comma-separated, case-insensitive) and that email is verified, whatever `AUTH_REQUIRE_EMAIL_VERIFICATION` says. Admins get the `/admin` area: Overview, People, Usage, AI & MCP, Health and Audit. Everyone else gets the not-found page.

The area shows counts and account facts only. It never shows students' marks, CA, test answers, submission content or files, AI-suggested marks, or per-student attendance. There is no impersonation.
Admins can suspend or unsuspend an account, sign a user out everywhere, and resend a verification email. Every such action is written to the audit log.

`SUPPORT_EMAIL` is optional and defaults to support@clasync.online. Every email the app sends uses it as the reply-to, and a suspended user who tries to sign in is told to contact it.

Set `ADMIN_EMAILS` and `SUPPORT_EMAIL` separately for each Vercel environment (Production and Preview), so the admins on staging are staging accounts.

## Sign in with Google

"Continue with Google" appears on the sign-in and sign-up pages, and as "Sign-in methods" in Settings, once `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` are both set. Without them the app is email and password only.

1. In Google Cloud, create an OAuth client ID of type "Web application" (APIs & Services, Credentials). Set up the consent screen first if asked: app name Clasync, scopes email, profile and openid.
2. Add the authorized redirect URI `<BETTER_AUTH_URL>/api/auth/callback/google`, for example `https://clasync.online/api/auth/callback/google`, `https://staging.clasync.online/api/auth/callback/google` or `http://localhost:3000/api/auth/callback/google`.
3. Set the two variables in each Vercel environment (Production and Preview) and in `.env.local`, then redeploy.

How it behaves:

- **Sign-up:** the visitor picks Lecturer or Student, then continues with Google. Name and email come from Google, and the email counts as verified. Students add their matricule when they join a class, as with email sign-up.
- **Sign-in:** a Google account with no Clasync account is sent to sign-up to pick a role first. A Google account whose email matches an existing, verified Clasync account signs in to that account and is connected to it. An unverified account is never joined this way: its owner signs in with their password and connects Google from Settings.
- **Settings:** connect Google to an existing account (the Google address may differ from the account's), or disconnect it while the account still has a password. Accounts created with Google have no password, so the "Change password" section is hidden for them.

## Deploying

Clasync runs in three places, each with its own database and file store:

| | Production | Staging | Local |
|---|---|---|---|
| Branch | `main` | `Development` | your branch |
| URL | https://clasync.online | https://staging.clasync.online (public, no Vercel login) | http://localhost:3000 |
| Vercel environment | Production | Preview | none |
| Database and files | production Prisma Postgres and Blob store | staging Prisma Postgres and Blob store | a local Postgres and `STORAGE_DRIVER=local` |
| Email | everyone | everyone (`EMAIL_ALLOWLIST=*`; a list of addresses limits it, and no list sends nothing) | logged, unless `RESEND_API_KEY` is set |

Work flows one way: a feature branch, a pull request into `Development` (CI runs lint, typecheck and tests), a check on staging, then a pull request from `Development` into `main`. Pull requests into `main` from any other branch fail CI.

Other branches also get a preview deployment on the staging database and store, but only `Development` signs in properly (staging's `BETTER_AUTH_URL`) and only `Development` migrates.

**Staging and production migrate themselves:** each `Development` build runs `npm run db:migrate` against the staging database, and each production build against the production database, before building (`scripts/vercel-build.sh`). A feature branch that adds tables won't work on its own preview until it reaches `Development`.

The migration runs while the previous version still serves traffic, and stays applied if the build then fails. Keep migrations additive (new tables, columns, indexes) so the version still running keeps working on the migrated database; a migration that drops or renames something needs a deploy in two steps.

Never point local development at the production or staging database (don't use `vercel env pull` for `DATABASE_URL`): a local `npm run db:migrate` on an unfinished branch would change that database's schema.
