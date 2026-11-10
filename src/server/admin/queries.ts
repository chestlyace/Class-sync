import { gateway } from 'ai'
import { and, count, desc, eq, gt, gte, ilike, inArray, isNotNull, isNull, lt, lte, max, or, sql, type SQL } from 'drizzle-orm'
import { alias, union, type PgColumn, type PgTable } from 'drizzle-orm/pg-core'
import { isAdmin, type Env } from '@/server/core/admin'
import { config } from '@/server/core/config'
import type { Ctx, Role } from '@/server/core/context'
import { AppError } from '@/server/core/errors'
import { requireAdmin } from '@/server/core/guards'
import type { Db } from '@/server/db'
import {
  adminAction,
  apikey,
  assignment,
  attendanceCheckIn,
  attendanceWindow,
  class_,
  classLecturer,
  classStudent,
  course,
  courseTest,
  file,
  oauthAccessToken,
  oauthClient,
  oauthConsent,
  opsEvent,
  resource,
  revisionOutcome,
  school,
  session,
  submission,
  testAnswer,
  testAttempt,
  user,
} from '@/server/db/schema'
import { containsPattern } from '@/server/lib/like'

// Read models for the admin dashboard. They stay inside the data fence (fence.test.ts): counts
// across the platform and account facts about people, never marks, submissions, answers, content,
// per-student attendance or credentials. Activity queries select count(*) and nothing else.

const HOUR_MS = 3_600_000
const DAY_MS = 24 * HOUR_MS
const SERIES_DAYS = 30
const CRON_STALE_MS = 26 * HOUR_MS
const CREDITS_TIMEOUT_MS = 5_000
const MAX_RECENT_FAILURES = 20
export const ADMIN_PAGE_SIZE = 50

/** One day of a series: `day` is YYYY-MM-DD in `config.timeZone`. */
export type DailyPoint = { day: string; value: number }

// ---------------------------------------------------------------------------------------------
// Daily series

/** The calendar day of `d` in the app's time zone, as YYYY-MM-DD. */
function localDay(d: Date): string {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: config.timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(d)
  const part = (type: string) => parts.find((p) => p.type === type)?.value
  return `${part('year')}-${part('month')}-${part('day')}`
}

/** The 30 calendar days ending with `at`'s day, oldest first. */
function seriesDays(at: Date): string[] {
  const [y, m, d] = localDay(at).split('-').map(Number)
  const today = Date.UTC(y, m - 1, d)
  return Array.from({ length: SERIES_DAYS }, (_, i) =>
    new Date(today - (SERIES_DAYS - 1 - i) * DAY_MS).toISOString().slice(0, 10),
  )
}

type DayCounts = Map<string, number>

/**
 * Rows per local day of `col`, counted in SQL. `naive` marks a timestamp without time zone (the
 * Better Auth tables), which holds UTC. The window is a little wider than 30 days; days outside
 * the series are dropped when it is filled.
 */
async function countByDay(
  db: Db,
  table: PgTable,
  col: PgColumn,
  at: Date,
  opts: { naive?: boolean; where?: SQL } = {},
): Promise<DayCounts> {
  const instant = opts.naive ? sql`(${col} at time zone 'UTC')` : sql`${col}`
  const day = sql<string>`to_char(date_trunc('day', ${instant} at time zone ${config.timeZone}), 'YYYY-MM-DD')`
  const rows = await db
    .select({ day, n: count() })
    .from(table)
    .where(and(gte(col, new Date(at.getTime() - (SERIES_DAYS + 1) * DAY_MS)), lt(col, new Date(at.getTime() + DAY_MS)), opts.where))
    .groupBy(sql`1`)
  return new Map(rows.map((r) => [r.day, r.n]))
}

/** Exactly 30 points, oldest first, zero where nothing happened. Several sources are added up. */
function fill(at: Date, ...sources: DayCounts[]): DailyPoint[] {
  return seriesDays(at).map((day) => ({ day, value: sources.reduce((n, s) => n + (s.get(day) ?? 0), 0) }))
}

async function countWhere(db: Db, table: PgTable, where?: SQL): Promise<number> {
  const [row] = await db.select({ n: count() }).from(table).where(where)
  return row.n
}

const daysBefore = (at: Date, days: number) => new Date(at.getTime() - days * DAY_MS)

// ---------------------------------------------------------------------------------------------
// Overview

export type Overview = {
  totals: { lecturers: number; students: number; schools: number; classes: number; courses: number; unverified: number; suspended: number }
  signups: { lecturers: DailyPoint[]; students: DailyPoint[] }
  active: { day1: number; day7: number; day30: number }
}

export async function getOverview(ctx: Ctx, at: Date): Promise<Overview> {
  requireAdmin(ctx)
  const { db } = ctx
  const [people, schools, classes, courses, lecturerSignups, studentSignups, day1, day7, day30] = await Promise.all([
    db
      .select({
        lecturers: sql<number>`count(*) filter (where ${user.role} = 'lecturer')`.mapWith(Number),
        students: sql<number>`count(*) filter (where ${user.role} = 'student')`.mapWith(Number),
        unverified: sql<number>`count(*) filter (where not ${user.emailVerified})`.mapWith(Number),
        suspended: sql<number>`count(*) filter (where ${user.suspendedAt} is not null)`.mapWith(Number),
      })
      .from(user),
    countWhere(db, school),
    countWhere(db, class_),
    countWhere(db, course),
    countByDay(db, user, user.createdAt, at, { naive: true, where: eq(user.role, 'lecturer') }),
    countByDay(db, user, user.createdAt, at, { naive: true, where: eq(user.role, 'student') }),
    countWhere(db, user, gte(user.lastSeenAt, daysBefore(at, 1))),
    countWhere(db, user, gte(user.lastSeenAt, daysBefore(at, 7))),
    countWhere(db, user, gte(user.lastSeenAt, daysBefore(at, 30))),
  ])
  const [p] = people
  return {
    totals: {
      lecturers: p.lecturers,
      students: p.students,
      schools,
      classes,
      courses,
      unverified: p.unverified,
      suspended: p.suspended,
    },
    signups: { lecturers: fill(at, lecturerSignups), students: fill(at, studentSignups) },
    active: { day1, day7, day30 },
  }
}

// ---------------------------------------------------------------------------------------------
// People

export type PersonRow = {
  id: string
  name: string
  email: string
  role: Role
  emailVerified: boolean
  createdAt: Date
  lastSignInAt: Date | null
  lastSeenAt: Date | null
  suspendedAt: Date | null
  isAdmin: boolean
}

export type PeopleQuery = { search?: string; role?: Role; verified?: boolean; suspended?: boolean; page: number }
export type Page<T> = { rows: T[]; total: number; page: number; pageSize: typeof ADMIN_PAGE_SIZE }

const personColumns = {
  id: user.id,
  name: user.name,
  email: user.email,
  role: user.role,
  emailVerified: user.emailVerified,
  createdAt: user.createdAt,
  lastSignInAt: user.lastSignInAt,
  lastSeenAt: user.lastSeenAt,
  suspendedAt: user.suspendedAt,
}

type PersonColumns = Omit<PersonRow, 'role' | 'isAdmin'> & { role: string }

function toPersonRow(r: PersonColumns): PersonRow {
  return { ...r, role: r.role as Role, isAdmin: isAdmin(r) }
}

function pageNumber(page: number): number {
  return Number.isFinite(page) && page >= 1 ? Math.floor(page) : 1
}

export async function listPeople(ctx: Ctx, q: PeopleQuery): Promise<Page<PersonRow>> {
  requireAdmin(ctx)
  const conditions: (SQL | undefined)[] = []
  const search = q.search?.trim()
  if (search) {
    const pattern = containsPattern(search)
    conditions.push(or(ilike(user.name, pattern), ilike(user.email, pattern)))
  }
  if (q.role) conditions.push(eq(user.role, q.role))
  if (q.verified !== undefined) conditions.push(eq(user.emailVerified, q.verified))
  if (q.suspended !== undefined) conditions.push(q.suspended ? isNotNull(user.suspendedAt) : isNull(user.suspendedAt))
  const where = and(...conditions)
  const page = pageNumber(q.page)
  const [rows, total] = await Promise.all([
    ctx.db
      .select(personColumns)
      .from(user)
      .where(where)
      .orderBy(desc(user.createdAt), desc(user.id))
      .limit(ADMIN_PAGE_SIZE)
      .offset((page - 1) * ADMIN_PAGE_SIZE),
    countWhere(ctx.db, user, where),
  ])
  return { rows: rows.map(toPersonRow), total, page, pageSize: ADMIN_PAGE_SIZE }
}

/**
 * An address cut down to its network: the first two IPv4 octets (`192.168.*.*`, also inside an
 * IPv4-mapped IPv6 address) or the first IPv6 group (`2001:*`). Anything else becomes `*`.
 */
export function maskIp(ip: string | null): string | null {
  if (!ip) return null
  const v4 = /(?:^|:)(\d{1,3})\.(\d{1,3})\.\d{1,3}\.\d{1,3}$/.exec(ip)
  if (v4) return `${v4[1]}.${v4[2]}.*.*`
  const v6 = /^([0-9a-f]{1,4}):[0-9a-f:]*$/i.exec(ip)
  if (v6) return `${v6[1]}:*`
  return '*'
}

export type PersonSession = { id: string; userAgent: string | null; ipMasked: string | null; updatedAt: Date; expiresAt: Date }
export type PersonConnection = { name: string | null; kind: 'oauth' | 'token'; lastUsedAt: Date | null }
export type PersonCounts = { schools: number; classes: number; courses: number } | { classes: number }

export type Person = PersonRow & {
  suspendedReason: string | null
  counts: PersonCounts
  sessions: PersonSession[]
  connections: PersonConnection[]
}

async function personCounts(db: Db, id: string, role: Role): Promise<PersonCounts> {
  if (role === 'student') {
    const classes = await countWhere(db, classStudent, and(eq(classStudent.userId, id), eq(classStudent.status, 'active')))
    return { classes }
  }
  const [[{ schools }], classes, courses] = await Promise.all([
    db
      .select({ schools: sql<number>`count(distinct ${class_.schoolId})`.mapWith(Number) })
      .from(classLecturer)
      .innerJoin(class_, eq(class_.id, classLecturer.classId))
      .where(eq(classLecturer.userId, id)),
    countWhere(db, classLecturer, eq(classLecturer.userId, id)),
    countWhere(db, course, eq(course.lecturerId, id)),
  ])
  return { schools, classes, courses }
}

/** OAuth apps the person allowed (last used = their newest access token) and their personal tokens. */
async function personConnections(db: Db, id: string): Promise<PersonConnection[]> {
  const [apps, tokens] = await Promise.all([
    db
      .select({ name: oauthClient.name, lastUsedAt: max(oauthAccessToken.createdAt) })
      .from(oauthConsent)
      .innerJoin(oauthClient, eq(oauthClient.clientId, oauthConsent.clientId))
      .leftJoin(oauthAccessToken, and(eq(oauthAccessToken.clientId, oauthConsent.clientId), eq(oauthAccessToken.userId, id)))
      .where(eq(oauthConsent.userId, id))
      .groupBy(oauthConsent.id, oauthClient.name)
      .orderBy(oauthClient.name),
    db
      .select({ name: apikey.name, lastUsedAt: apikey.lastRequest })
      .from(apikey)
      .where(and(eq(apikey.referenceId, id), eq(apikey.enabled, true)))
      .orderBy(desc(apikey.createdAt)),
  ])
  return [
    ...apps.map((a) => ({ name: a.name, kind: 'oauth' as const, lastUsedAt: a.lastUsedAt })),
    ...tokens.map((t) => ({ name: t.name, kind: 'token' as const, lastUsedAt: t.lastUsedAt })),
  ]
}

export async function getPerson(ctx: Ctx, id: string): Promise<Person> {
  requireAdmin(ctx)
  const { db } = ctx
  const [row] = await db
    .select({ ...personColumns, suspendedReason: user.suspendedReason })
    .from(user)
    .where(eq(user.id, id))
  if (!row) throw new AppError('NOT_FOUND', 'No such user')
  const { suspendedReason, ...person } = row
  const base = toPersonRow(person)
  const [counts, sessions, connections] = await Promise.all([
    personCounts(db, id, base.role),
    db
      .select({
        id: session.id,
        userAgent: session.userAgent,
        ipAddress: session.ipAddress,
        updatedAt: session.updatedAt,
        expiresAt: session.expiresAt,
      })
      .from(session)
      .where(eq(session.userId, id))
      .orderBy(desc(session.updatedAt)),
    personConnections(db, id),
  ])
  return {
    ...base,
    suspendedReason,
    counts,
    sessions: sessions.map((s) => ({
      id: s.id,
      userAgent: s.userAgent,
      ipMasked: maskIp(s.ipAddress),
      updatedAt: s.updatedAt,
      expiresAt: s.expiresAt,
    })),
    connections,
  }
}

// ---------------------------------------------------------------------------------------------
// Usage

export const USAGE_SERIES = [
  'checkInsOpened',
  'checkIns',
  'assignmentsPublished',
  'submissions',
  'testsStarted',
  'testAttempts',
  'resourcesAdded',
  'practiceAnswers',
] as const
export type UsageSeries = (typeof USAGE_SERIES)[number]

export async function getUsage(ctx: Ctx, at: Date): Promise<Record<UsageSeries, DailyPoint[]>> {
  requireAdmin(ctx)
  const { db } = ctx
  const [checkInsOpened, checkIns, assignmentsPublished, submissions, testsStarted, testAttempts, resourcesAdded, practiceAnswers] =
    await Promise.all([
      countByDay(db, attendanceWindow, attendanceWindow.openedAt, at),
      countByDay(db, attendanceCheckIn, attendanceCheckIn.checkedInAt, at),
      countByDay(db, assignment, assignment.publishedAt, at),
      countByDay(db, submission, submission.submittedAt, at),
      countByDay(db, courseTest, courseTest.startedAt, at),
      countByDay(db, testAttempt, testAttempt.joinedAt, at),
      countByDay(db, resource, resource.createdAt, at),
      countByDay(db, revisionOutcome, revisionOutcome.answeredAt, at),
    ])
  return {
    checkInsOpened: fill(at, checkInsOpened),
    checkIns: fill(at, checkIns),
    assignmentsPublished: fill(at, assignmentsPublished),
    submissions: fill(at, submissions),
    testsStarted: fill(at, testsStarted),
    testAttempts: fill(at, testAttempts),
    resourcesAdded: fill(at, resourcesAdded),
    practiceAnswers: fill(at, practiceAnswers),
  }
}

// ---------------------------------------------------------------------------------------------
// AI and MCP

export type Credits = { balance: string; totalUsed: string }

export type AiAndMcp = {
  credits: Credits | null
  suggestions: DailyPoint[]
  mcp: { lecturersConnected: number; oauthConnections: number; personalTokens: number; requests7d: number; rateLimited7d: number }
}

async function gatewayCredits(): Promise<Credits> {
  return gateway.getCredits()
}

/** The AI Gateway balance, or null when the call fails or takes too long. */
async function safeCredits(credits: () => Promise<Credits>): Promise<Credits | null> {
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error('credits timed out')), CREDITS_TIMEOUT_MS)
    })
    const c = await Promise.race([credits(), timeout])
    return { balance: c.balance, totalUsed: c.totalUsed }
  } catch {
    return null
  } finally {
    clearTimeout(timer)
  }
}

/** A personal token that still works at `at`. */
function liveToken(at: Date): SQL | undefined {
  return and(eq(apikey.enabled, true), or(isNull(apikey.expiresAt), gt(apikey.expiresAt, at)))
}

function mcpWindow(at: Date): SQL | undefined {
  return and(eq(opsEvent.kind, 'mcp_request'), gte(opsEvent.at, daysBefore(at, 7)), lte(opsEvent.at, at))
}

export async function getAiAndMcp(ctx: Ctx, at: Date, credits: () => Promise<Credits> = gatewayCredits): Promise<AiAndMcp> {
  requireAdmin(ctx)
  const { db } = ctx
  // Lecturers with an allowed OAuth app or a live token; union removes repeats.
  const connected = union(
    db.select({ userId: sql<string>`${oauthConsent.userId}`.as('user_id') }).from(oauthConsent).where(isNotNull(oauthConsent.userId)),
    db.select({ userId: sql<string>`${apikey.referenceId}`.as('user_id') }).from(apikey).where(liveToken(at)),
  ).as('connected')
  const [creditInfo, answerSuggestions, submissionSuggestions, [{ lecturersConnected }], oauthConnections, personalTokens, requests7d, rateLimited7d] =
    await Promise.all([
      safeCredits(credits),
      countByDay(db, testAnswer, testAnswer.suggestedAt, at),
      countByDay(db, submission, submission.suggestedAt, at),
      db.select({ lecturersConnected: count() }).from(connected),
      countWhere(db, oauthConsent, isNotNull(oauthConsent.userId)),
      countWhere(db, apikey, liveToken(at)),
      countWhere(db, opsEvent, mcpWindow(at)),
      countWhere(db, opsEvent, and(mcpWindow(at), sql`${opsEvent.detail}->>'status' = '429'`)),
    ])
  return {
    credits: creditInfo,
    suggestions: fill(at, answerSuggestions, submissionSuggestions),
    mcp: { lecturersConnected, oauthConnections, personalTokens, requests7d, rateLimited7d },
  }
}

// ---------------------------------------------------------------------------------------------
// Health

export type Health = {
  cron: { lastRunAt: Date | null; ok: boolean | null; assignments?: number; reminded?: number; stale: boolean; runsHere: boolean }
  email: { sent7d: number; failed7d: number; recentFailures: { at: Date; kind: string | null; to: string | null; error: string | null }[] }
  files: { count: number; bytes: number }
  /** `migrations` is null when drizzle's migrations table can't be read. */
  env: { name: string; commit: string | null; migrations: number | null }
}

const detailText = (field: string) => sql<string | null>`${opsEvent.detail}->>${field}`
const detailInt = (field: string) => sql<number | null>`(${opsEvent.detail}->>${field})::int`
/** A batch event stands for `count` emails; a single one for one. */
const emailsInEvent = sql`coalesce((${opsEvent.detail}->>'count')::int, 1)`

export async function getHealth(ctx: Ctx, at: Date, env: Env = process.env): Promise<Health> {
  requireAdmin(ctx)
  const { db } = ctx
  const runsHere = env.VERCEL_ENV === 'production'
  const [[cron], [email], recentFailures, [files], migrations, [{ oldestEventAt }]] = await Promise.all([
    db
      .select({
        at: opsEvent.at,
        ok: opsEvent.ok,
        assignments: detailInt('assignments'),
        reminded: detailInt('reminded'),
      })
      .from(opsEvent)
      .where(and(eq(opsEvent.kind, 'cron_reminders'), lte(opsEvent.at, at)))
      .orderBy(desc(opsEvent.at))
      .limit(1),
    db
      .select({
        sent7d: sql<number>`coalesce(sum(${emailsInEvent}) filter (where ${opsEvent.kind} = 'email_sent'), 0)`.mapWith(Number),
        failed7d: sql<number>`coalesce(sum(${emailsInEvent}) filter (where ${opsEvent.kind} = 'email_failed'), 0)`.mapWith(Number),
      })
      .from(opsEvent)
      .where(
        and(inArray(opsEvent.kind, ['email_sent', 'email_failed']), gte(opsEvent.at, daysBefore(at, 7)), lte(opsEvent.at, at)),
      ),
    db
      .select({ at: opsEvent.at, kind: detailText('kind'), to: detailText('to'), error: detailText('error') })
      .from(opsEvent)
      .where(and(eq(opsEvent.kind, 'email_failed'), lte(opsEvent.at, at)))
      .orderBy(desc(opsEvent.at))
      .limit(MAX_RECENT_FAILURES),
    db
      .select({ count: count(), bytes: sql<number>`coalesce(sum(${file.sizeBytes}), 0)`.mapWith(Number) })
      .from(file)
      .where(isNotNull(file.confirmedAt)),
    // The table drizzle's migrator writes, one row per applied migration. If it's missing or
    // unreadable the page still renders, with the count unknown.
    db
      .select({ n: count() })
      .from(sql`drizzle.__drizzle_migrations`)
      .then(([row]) => row.n)
      .catch((error: unknown) => {
        console.error('[admin] could not count applied migrations', error)
        return null
      }),
    // How long the app has been recording health events: the cron can't be overdue before that.
    db.select({ oldestEventAt: sql<Date | null>`min(${opsEvent.at})`.mapWith(opsEvent.at) }).from(opsEvent).where(lte(opsEvent.at, at)),
  ])
  const cronInfo: Health['cron'] = cron
    ? {
        lastRunAt: cron.at,
        ok: cron.ok,
        ...(cron.assignments !== null ? { assignments: cron.assignments } : {}),
        ...(cron.reminded !== null ? { reminded: cron.reminded } : {}),
        stale: runsHere && at.getTime() - cron.at.getTime() > CRON_STALE_MS,
        runsHere,
      }
    : // Never run: overdue only once events have been recorded for longer than the cron's period,
      // so a fresh release doesn't warn before the first run was due.
      {
        lastRunAt: null,
        ok: null,
        stale: runsHere && oldestEventAt !== null && at.getTime() - oldestEventAt.getTime() > CRON_STALE_MS,
        runsHere,
      }
  return {
    cron: cronInfo,
    email: {
      sent7d: email.sent7d,
      failed7d: email.failed7d,
      // Already masked when recorded; a batch has no single recipient.
      recentFailures: recentFailures.map((f) => ({ ...f, to: f.kind === 'batch' ? null : f.to })),
    },
    files: { count: files.count, bytes: files.bytes },
    env: {
      name: env.VERCEL_ENV || 'local',
      commit: env.VERCEL_GIT_COMMIT_SHA ? env.VERCEL_GIT_COMMIT_SHA.slice(0, 7) : null,
      migrations,
    },
  }
}

// ---------------------------------------------------------------------------------------------
// Audit

export type AuditRow = {
  at: Date
  adminName: string
  action: (typeof adminAction.$inferSelect)['action']
  targetName: string
  targetEmail: string
  reason: string | null
}

export async function listAudit(ctx: Ctx, page: number): Promise<Page<AuditRow>> {
  requireAdmin(ctx)
  const p = pageNumber(page)
  const admin = alias(user, 'admin_user')
  const target = alias(user, 'target_user')
  const [rows, total] = await Promise.all([
    ctx.db
      .select({
        at: adminAction.at,
        adminName: admin.name,
        action: adminAction.action,
        targetName: target.name,
        targetEmail: target.email,
        reason: adminAction.reason,
      })
      .from(adminAction)
      .innerJoin(admin, eq(admin.id, adminAction.adminId))
      .innerJoin(target, eq(target.id, adminAction.targetUserId))
      .orderBy(desc(adminAction.at), desc(adminAction.id))
      .limit(ADMIN_PAGE_SIZE)
      .offset((p - 1) * ADMIN_PAGE_SIZE),
    countWhere(ctx.db, adminAction),
  ])
  return { rows, total, page: p, pageSize: ADMIN_PAGE_SIZE }
}
