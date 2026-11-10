import { readFileSync } from 'node:fs'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { eq } from 'drizzle-orm'
import { config } from '@/server/core/config'
import type { Ctx, SessionUser } from '@/server/core/context'
import type { Db } from '@/server/db'
import {
  adminAction,
  apikey,
  assignment,
  attendanceCheckIn,
  attendanceSession,
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
  school,
  session,
  submission,
  testAnswer,
  testAttempt,
  testQuestion,
  user,
} from '@/server/db/schema'
import { createTestDb } from '@/test/db'
import { ctxFor, makeUser } from '@/test/factories'
import {
  getAiAndMcp,
  getHealth,
  getOverview,
  getPerson,
  getUsage,
  listAudit,
  listPeople,
  maskIp,
  type DailyPoint,
} from './queries'

const HOUR = 3_600_000
const DAY = 24 * HOUR

const dayIn = (d: Date) =>
  new Intl.DateTimeFormat('en-CA', { timeZone: config.timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(d)

/** The point for `d`'s calendar day, asserting the series shape on the way. */
function pointFor(series: DailyPoint[], d: Date): DailyPoint | undefined {
  return series.find((p) => p.day === dayIn(d))
}

function expectThirtyDays(series: DailyPoint[], at: Date) {
  expect(series).toHaveLength(30)
  expect(series[29].day).toBe(dayIn(at))
  expect(series[0].day).toBe(dayIn(new Date(at.getTime() - 29 * DAY)))
  for (let i = 1; i < series.length; i++) expect(series[i].day > series[i - 1].day).toBe(true)
}

const sum = (series: DailyPoint[]) => series.reduce((n, p) => n + p.value, 0)

describe('admin read models', () => {
  let db: Db
  let admin: SessionUser
  let lec2: SessionUser
  let s1: SessionUser
  let s2: SessionUser
  let s3: SessionUser
  let adminCtx: Ctx
  let tokenUsedAt: Date
  let cronAt: Date

  beforeAll(async () => {
    db = await createTestDb()
    const now = Date.now()
    admin = await makeUser(db, { role: 'lecturer', name: 'Dr Admin', email: `admin-${crypto.randomUUID().slice(0, 8)}@example.com` })
    lec2 = await makeUser(db, { role: 'lecturer', name: 'Dr Second' })
    s1 = await makeUser(db, { role: 'student', name: 'Student One' })
    s2 = await makeUser(db, { role: 'student', name: 'Student Two', emailVerified: false })
    s3 = await makeUser(db, { role: 'student', name: 'Student Three' })
    vi.stubEnv('ADMIN_EMAILS', admin.email)
    adminCtx = ctxFor(db, admin)

    // Activity and account state.
    await db.update(user).set({ lastSeenAt: new Date(now - HOUR) }).where(eq(user.id, admin.id))
    await db
      .update(user)
      .set({ lastSeenAt: new Date(now - 3 * DAY), createdAt: new Date(now - 3 * DAY) })
      .where(eq(user.id, lec2.id))
    await db.update(user).set({ lastSeenAt: new Date(now - 20 * DAY) }).where(eq(user.id, s1.id))
    await db.update(user).set({ suspendedAt: new Date(now - HOUR), suspendedReason: 'spam' }).where(eq(user.id, s3.id))

    // A school, a class with two students, a course.
    const [sch] = await db
      .insert(school)
      .values({ name: 'University of Buea', town: 'Buea', nameKey: 'university of buea', townKey: 'buea', createdBy: admin.id })
      .returning({ id: school.id })
    const [cls] = await db
      .insert(class_)
      .values({ schoolId: sch.id, name: 'Biology L1', academicYear: '2026/27', studentCode: 'STU001', lecturerCode: 'LEC001', createdBy: admin.id })
      .returning({ id: class_.id })
    await db.insert(classLecturer).values({ classId: cls.id, userId: admin.id })
    await db.insert(classStudent).values([
      { classId: cls.id, userId: s1.id, matricule: 'UB1' },
      { classId: cls.id, userId: s2.id, matricule: 'UB2' },
    ])
    const [crs] = await db
      .insert(course)
      .values({ classId: cls.id, lecturerId: admin.id, title: 'Cell biology', semester: 1 })
      .returning({ id: course.id })

    // Attendance: one window with one check-in.
    const [ses] = await db.insert(attendanceSession).values({ courseId: crs.id, createdBy: admin.id }).returning({ id: attendanceSession.id })
    const [win] = await db
      .insert(attendanceWindow)
      .values({ sessionId: ses.id, kind: 'start', secret: 's3cret', openedBy: admin.id })
      .returning({ id: attendanceWindow.id })
    await db.insert(attendanceCheckIn).values({ windowId: win.id, studentId: s1.id })

    // A published assignment with one submission.
    const [asg] = await db
      .insert(assignment)
      .values({
        courseId: crs.id,
        title: 'Essay',
        dueAt: new Date(now + 7 * DAY),
        maxMark: 20,
        submissionMode: 'text',
        status: 'published',
        publishedAt: new Date(now),
        createdBy: admin.id,
      })
      .returning({ id: assignment.id })
    await db.insert(submission).values({ assignmentId: asg.id, studentId: s1.id, submittedAt: new Date(now), mark: 15, feedback: 'Good' })

    // A started test with one attempt and one AI-suggested answer.
    const [tst] = await db
      .insert(courseTest)
      .values({
        courseId: crs.id,
        code: 'TST001',
        title: 'CA 1',
        durationMinutes: 30,
        defaultMark: 2,
        startedAt: new Date(now),
        deadlineAt: new Date(now + 30 * 60_000),
        createdBy: admin.id,
      })
      .returning({ id: courseTest.id })
    const [q] = await db
      .insert(testQuestion)
      .values({ testId: tst.id, position: 0, kind: 'short', prompt: 'What is osmosis?' })
      .returning({ id: testQuestion.id })
    const [att] = await db
      .insert(testAttempt)
      .values({ testId: tst.id, studentId: s1.id, seed: 'seed', deviceId: 'dev-1', deviceSeenAt: new Date(now) })
      .returning({ id: testAttempt.id })
    await db.insert(testAnswer).values({
      attemptId: att.id,
      questionId: q.id,
      text: 'Water moves',
      rev: 1,
      receivedAt: new Date(now),
      suggestedMark: 1,
      suggestedReason: 'Half right',
      suggestedAt: new Date(now),
    })

    // A note, one confirmed file and one never confirmed.
    await db.insert(resource).values({ ownerId: admin.id, kind: 'note', title: 'Week 1' })
    await db.insert(file).values([
      { ownerId: admin.id, purpose: 'resource', storageKey: 'k-1', name: 'a.pdf', mimeType: 'application/pdf', sizeBytes: 1234, confirmedAt: new Date(now) },
      { ownerId: admin.id, purpose: 'resource', storageKey: 'k-2', name: 'b.pdf', mimeType: 'application/pdf', sizeBytes: 999 },
    ])

    // Health events: emails (one failed, one batch, one too old), MCP requests, a cron run 30 h ago.
    cronAt = new Date(now - 30 * HOUR)
    await db.insert(opsEvent).values([
      { kind: 'email_sent', ok: true, at: new Date(now - 2 * HOUR), detail: { kind: 'verification', to: 'a***@example.com' } },
      { kind: 'email_failed', ok: false, at: new Date(now - HOUR), detail: { kind: 'reset', to: 'b***@example.com', error: 'boom' } },
      { kind: 'email_sent', ok: true, at: new Date(now - 3 * HOUR), detail: { kind: 'batch', count: 3 } },
      { kind: 'email_sent', ok: true, at: new Date(now - 8 * DAY), detail: { kind: 'verification', to: 'c***@example.com' } },
      { kind: 'mcp_request', ok: true, at: new Date(now - HOUR), detail: { status: 200 } },
      { kind: 'mcp_request', ok: true, at: new Date(now - HOUR), detail: { status: 429 } },
      { kind: 'mcp_request', ok: true, at: new Date(now - 9 * DAY), detail: { status: 200 } },
      { kind: 'cron_reminders', ok: true, at: cronAt, detail: { assignments: 2, reminded: 5 } },
    ])

    // Sessions: two for s1 (IPv4 and IPv6), one for s2.
    await db.insert(session).values([
      { id: 'ses-1', token: 'tok-1', userId: s1.id, expiresAt: new Date(now + DAY), ipAddress: '192.168.1.20', userAgent: 'Firefox' },
      { id: 'ses-2', token: 'tok-2', userId: s1.id, expiresAt: new Date(now + DAY), ipAddress: '2001:db8::1', userAgent: 'Safari' },
      { id: 'ses-3', token: 'tok-3', userId: s2.id, expiresAt: new Date(now + DAY), ipAddress: '10.0.0.1', userAgent: 'Chrome' },
    ])

    // MCP: a personal token for the admin, an OAuth app the second lecturer allowed.
    tokenUsedAt = new Date(now - 2 * HOUR)
    await db.insert(apikey).values({
      id: 'key-1',
      referenceId: admin.id,
      name: 'Laptop',
      key: 'hashed-key',
      lastRequest: new Date(now - HOUR),
      createdAt: new Date(now - DAY),
      updatedAt: new Date(now - DAY),
    })
    await db.insert(oauthClient).values({ id: 'oc-1', clientId: 'client-1', name: 'Claude', redirectUris: ['https://example.com/cb'] })
    await db.insert(oauthConsent).values({
      id: 'cons-1',
      clientId: 'client-1',
      userId: lec2.id,
      scopes: ['openid'],
      createdAt: new Date(now - DAY),
      updatedAt: new Date(now - DAY),
    })
    await db.insert(oauthAccessToken).values([
      { id: 'at-1', token: 'at-1', clientId: 'client-1', userId: lec2.id, expiresAt: new Date(now + HOUR), createdAt: new Date(now - 5 * HOUR), scopes: [] },
      { id: 'at-2', token: 'at-2', clientId: 'client-1', userId: lec2.id, expiresAt: new Date(now + HOUR), createdAt: tokenUsedAt, scopes: [] },
    ])

    // Audit: the older row first.
    await db.insert(adminAction).values([
      { adminId: admin.id, action: 'suspend', targetUserId: s3.id, reason: 'spam', at: new Date(now - 2 * HOUR) },
      { adminId: admin.id, action: 'resend_verification', targetUserId: s2.id, reason: null, at: new Date(now - HOUR) },
    ])
  })

  afterAll(() => {
    vi.unstubAllEnvs()
  })

  it('getOverview counts totals, daily signups and active users', async () => {
    const at = new Date()
    const o = await getOverview(adminCtx, at)
    expect(o.totals).toEqual({ lecturers: 2, students: 3, schools: 1, classes: 1, courses: 1, unverified: 1, suspended: 1 })
    expectThirtyDays(o.signups.lecturers, at)
    expectThirtyDays(o.signups.students, at)
    expect(o.signups.lecturers[29].value).toBe(1)
    expect(pointFor(o.signups.lecturers, new Date(at.getTime() - 3 * DAY))?.value).toBe(1)
    expect(sum(o.signups.lecturers)).toBe(2)
    expect(o.signups.students[29].value).toBe(3)
    expect(sum(o.signups.students)).toBe(3)
    expect(o.active).toEqual({ day1: 1, day7: 2, day30: 3 })
  })

  it('listPeople searches case-insensitively and filters', async () => {
    const found = await listPeople(adminCtx, { search: 'STUD', page: 1 })
    expect(found.total).toBe(3)
    expect(found.rows.map((r) => r.id).sort()).toEqual([s1.id, s2.id, s3.id].sort())
    expect(found.pageSize).toBe(50)
    expect(found.page).toBe(1)

    const byEmail = await listPeople(adminCtx, { search: admin.email.toUpperCase(), page: 1 })
    expect(byEmail.rows.map((r) => r.id)).toEqual([admin.id])
    expect(byEmail.rows[0].isAdmin).toBe(true)

    const literal = await listPeople(adminCtx, { search: '%', page: 1 })
    expect(literal.total).toBe(0)

    const suspended = await listPeople(adminCtx, { suspended: true, page: 1 })
    expect(suspended.rows.map((r) => r.id)).toEqual([s3.id])
    expect(suspended.rows[0].suspendedAt).toBeInstanceOf(Date)

    const unverified = await listPeople(adminCtx, { verified: false, page: 1 })
    expect(unverified.rows.map((r) => r.id)).toEqual([s2.id])

    const lecturers = await listPeople(adminCtx, { role: 'lecturer', page: 1 })
    expect(lecturers.total).toBe(2)
    // createdAt desc: the second lecturer signed up three days ago.
    expect(lecturers.rows.map((r) => r.id)).toEqual([admin.id, lec2.id])
    expect(Object.keys(lecturers.rows[0]).sort()).toEqual(
      ['createdAt', 'email', 'emailVerified', 'id', 'isAdmin', 'lastSeenAt', 'lastSignInAt', 'name', 'role', 'suspendedAt'].sort(),
    )
  })

  it('getPerson gives per-role counts, own sessions with masked IPs and connections', async () => {
    const a = await getPerson(adminCtx, admin.id)
    expect(a).toMatchObject({ id: admin.id, role: 'lecturer', isAdmin: true, suspendedReason: null })
    expect(a.counts).toEqual({ schools: 1, classes: 1, courses: 1 })
    expect(a.sessions).toEqual([])
    expect(a.connections).toEqual([{ name: 'Laptop', kind: 'token', lastUsedAt: expect.any(Date) }])

    const l2 = await getPerson(adminCtx, lec2.id)
    expect(l2.counts).toEqual({ schools: 0, classes: 0, courses: 0 })
    expect(l2.connections).toEqual([{ name: 'Claude', kind: 'oauth', lastUsedAt: tokenUsedAt }])

    const one = await getPerson(adminCtx, s1.id)
    expect(one.counts).toEqual({ classes: 1 })
    expect(one.sessions.map((s) => s.id).sort()).toEqual(['ses-1', 'ses-2'])
    expect(one.sessions.map((s) => s.ipMasked).sort()).toEqual(['192.168.*.*', '2001:*'])
    for (const s of one.sessions) {
      expect(Object.keys(s).sort()).toEqual(['expiresAt', 'id', 'ipMasked', 'updatedAt', 'userAgent'])
    }
    expect(one.connections).toEqual([])

    const three = await getPerson(adminCtx, s3.id)
    expect(three.counts).toEqual({ classes: 0 })
    expect(three.suspendedReason).toBe('spam')
    expect(three.sessions).toEqual([])

    await expect(getPerson(adminCtx, 'nope')).rejects.toMatchObject({ code: 'NOT_FOUND' })
  })

  it('getUsage counts each activity per day', async () => {
    const at = new Date()
    const u = await getUsage(adminCtx, at)
    expect(Object.keys(u).sort()).toEqual(
      ['assignmentsPublished', 'checkIns', 'checkInsOpened', 'practiceAnswers', 'resourcesAdded', 'submissions', 'testAttempts', 'testsStarted'].sort(),
    )
    for (const series of Object.values(u)) expectThirtyDays(series, at)
    expect(u.checkInsOpened[29].value).toBe(1)
    expect(u.checkIns[29].value).toBe(1)
    expect(u.assignmentsPublished[29].value).toBe(1)
    expect(u.submissions[29].value).toBe(1)
    expect(u.testsStarted[29].value).toBe(1)
    expect(u.testAttempts[29].value).toBe(1)
    expect(u.resourcesAdded[29].value).toBe(1)
    expect(sum(u.practiceAnswers)).toBe(0)
  })

  it('getAiAndMcp gives null credits when the call throws, and counts suggestions and MCP use', async () => {
    const at = new Date()
    const r = await getAiAndMcp(adminCtx, at, async () => {
      throw new Error('no gateway')
    })
    expect(r.credits).toBeNull()
    expectThirtyDays(r.suggestions, at)
    expect(sum(r.suggestions)).toBe(1)
    expect(r.suggestions[29].value).toBe(1)
    expect(r.mcp).toEqual({ lecturersConnected: 2, oauthConnections: 1, personalTokens: 1, requests7d: 2, rateLimited7d: 1 })

    const ok = await getAiAndMcp(adminCtx, at, async () => ({ balance: '12.50', totalUsed: '3.10' }))
    expect(ok.credits).toEqual({ balance: '12.50', totalUsed: '3.10' })
  })

  it('getHealth reports cron staleness, email, files and the deployment', async () => {
    const at = new Date()
    const prod = await getHealth(adminCtx, at, { VERCEL_ENV: 'production', VERCEL_GIT_COMMIT_SHA: 'abcdef1234567890' })
    expect(prod.cron).toEqual({ lastRunAt: cronAt, ok: true, assignments: 2, reminded: 5, stale: true, runsHere: true })
    expect(prod.env.name).toBe('production')
    expect(prod.env.commit).toBe('abcdef1')
    const journal = JSON.parse(readFileSync(path.resolve(process.cwd(), 'drizzle/meta/_journal.json'), 'utf8'))
    expect(prod.env.migrations).toBe(journal.entries.length)

    const preview = await getHealth(adminCtx, at, { VERCEL_ENV: 'preview' })
    expect(preview.cron.stale).toBe(false)
    expect(preview.cron.runsHere).toBe(false)

    const local = await getHealth(adminCtx, at, {})
    expect(local.env).toMatchObject({ name: 'local', commit: null })

    expect(prod.email.sent7d).toBe(4)
    expect(prod.email.failed7d).toBe(1)
    expect(prod.email.recentFailures).toEqual([{ at: expect.any(Date), kind: 'reset', to: 'b***@example.com', error: 'boom' }])
    expect(prod.files).toEqual({ count: 1, bytes: 1234 })
  })

  it('getHealth is stale in production when the cron has never run, and fresh after a recent run', async () => {
    const fresh = await getHealth(adminCtx, new Date(cronAt.getTime() + HOUR), { VERCEL_ENV: 'production' })
    expect(fresh.cron.stale).toBe(false)
    const before = await getHealth(adminCtx, new Date(cronAt.getTime() - HOUR), { VERCEL_ENV: 'production' })
    expect(before.cron).toMatchObject({ lastRunAt: null, ok: null, stale: true, runsHere: true })
  })

  it('getHealth gives a null recipient for a failed batch', async () => {
    const id = crypto.randomUUID()
    await db.insert(opsEvent).values({ id, kind: 'email_failed', ok: false, detail: { kind: 'batch', count: 2, error: 'rate limited' } })
    try {
      const h = await getHealth(adminCtx, new Date(), {})
      expect(h.email.failed7d).toBe(3)
      expect(h.email.recentFailures[0]).toMatchObject({ kind: 'batch', to: null, error: 'rate limited' })
    } finally {
      await db.delete(opsEvent).where(eq(opsEvent.id, id))
    }
  })

  it('listAudit lists newest first with names', async () => {
    const a = await listAudit(adminCtx, 1)
    expect(a.total).toBe(2)
    expect(a.pageSize).toBe(50)
    expect(a.rows).toEqual([
      { at: expect.any(Date), adminName: 'Dr Admin', action: 'resend_verification', targetName: 'Student Two', targetEmail: s2.email, reason: null },
      { at: expect.any(Date), adminName: 'Dr Admin', action: 'suspend', targetName: 'Student Three', targetEmail: s3.email, reason: 'spam' },
    ])
  })

  it('throws NOT_FOUND from every read for a non-admin', async () => {
    const ctx = ctxFor(db, lec2)
    const at = new Date()
    await expect(getOverview(ctx, at)).rejects.toMatchObject({ code: 'NOT_FOUND' })
    await expect(listPeople(ctx, { page: 1 })).rejects.toMatchObject({ code: 'NOT_FOUND' })
    await expect(getPerson(ctx, s1.id)).rejects.toMatchObject({ code: 'NOT_FOUND' })
    await expect(getUsage(ctx, at)).rejects.toMatchObject({ code: 'NOT_FOUND' })
    const credits = vi.fn(async () => ({ balance: '1', totalUsed: '0' }))
    await expect(getAiAndMcp(ctx, at, credits)).rejects.toMatchObject({ code: 'NOT_FOUND' })
    expect(credits).not.toHaveBeenCalled()
    await expect(getHealth(ctx, at, {})).rejects.toMatchObject({ code: 'NOT_FOUND' })
    await expect(listAudit(ctx, 1)).rejects.toMatchObject({ code: 'NOT_FOUND' })
  })
})

describe('listPeople paging', () => {
  let db: Db
  let admin: SessionUser

  beforeAll(async () => {
    db = await createTestDb()
    admin = await makeUser(db, { email: `admin-${crypto.randomUUID().slice(0, 8)}@example.com` })
    vi.stubEnv('ADMIN_EMAILS', admin.email)
    for (let i = 0; i < 50; i++) await makeUser(db, { role: 'student' })
  })
  afterAll(() => {
    vi.unstubAllEnvs()
  })

  it('puts the 51st user alone on page 2', async () => {
    const ctx = ctxFor(db, admin)
    const p1 = await listPeople(ctx, { page: 1 })
    const p2 = await listPeople(ctx, { page: 2 })
    expect(p1.total).toBe(51)
    expect(p1.rows).toHaveLength(50)
    expect(p2.rows).toHaveLength(1)
    expect(p2.page).toBe(2)
    expect(new Set([...p1.rows, ...p2.rows].map((r) => r.id)).size).toBe(51)
  })
})

describe('maskIp', () => {
  it('keeps the first two IPv4 octets or the first IPv6 group', () => {
    expect(maskIp('192.168.1.20')).toBe('192.168.*.*')
    expect(maskIp('2001:db8::1')).toBe('2001:*')
    expect(maskIp('::ffff:10.1.2.3')).toBe('10.1.*.*')
    expect(maskIp('::1')).toBe('*')
    expect(maskIp(null)).toBeNull()
    expect(maskIp('')).toBeNull()
    expect(maskIp('not an ip')).toBe('*')
  })
})
