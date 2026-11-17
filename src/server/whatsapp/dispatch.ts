import { and, eq, inArray, isNotNull } from 'drizzle-orm'
import { createElement } from 'react'
import { Html, Text } from '@react-email/components'
import { localesOf } from '@/server/assignments/queries'
import { windowState } from '@/server/attendance/sessions'
import { courseRosterQuery } from '@/server/courses/roster'
import { adminEmails } from '@/server/core/admin'
import type { Locale } from '@/server/core/context'
import type { Db } from '@/server/db'
import {
  assignment,
  attendanceCheckIn,
  attendanceSession,
  attendanceWindow,
  course,
  courseTest,
  submission,
  testAttempt,
  user,
  whatsappLink,
  whatsappMessage,
  whatsappPreference,
  type WhatsAppKind,
} from '@/server/db/schema'
import { sendEmail } from '@/server/email/send'
import { scrubError } from '@/server/ops/events'
import { testPhase } from '@/server/tests/phase'
import { claimSend, noteCapReached, releaseClaim } from './cap'
import { isAllowedWhatsAppNumber, whatsAppConfig } from './config'
import { eventKey, type WhatsAppEvent } from './events'
import { whatsAppProvider, type TemplateMessage } from './provider'
import { buildTemplate } from './templates'

type PreferenceColumn = 'checkin' | 'tests' | 'results' | 'assignments' | 'classSoon'

/** Who should hear about one event, and how the message reads for each of them. */
type Plan = {
  kind: WhatsAppKind
  preference: PreferenceColumn
  userIds: string[]
  template: (locale: Locale) => TemplateMessage
}

/** Students handled at once: one slow provider call must not stall the batch, and 60 s is the limit. */
const BATCH = 10

/** The roster student ids on a course. */
async function rosterIds(db: Db, courseId: string): Promise<string[]> {
  return (await courseRosterQuery(db, { courseId })).map((r) => r.studentId)
}

/**
 * Works out, as of `at`, who an event still concerns. Null when it no longer does (the window closed, the
 * test ended, the thing was deleted), so a late delivery sends nothing stale.
 */
async function planFor(db: Db, event: WhatsAppEvent, at: Date): Promise<Plan | null> {
  switch (event.kind) {
    case 'checkinOpen': {
      const [row] = await db
        .select({ window: attendanceWindow, courseId: attendanceSession.courseId, courseTitle: course.title })
        .from(attendanceWindow)
        .innerJoin(attendanceSession, eq(attendanceSession.id, attendanceWindow.sessionId))
        .innerJoin(course, eq(course.id, attendanceSession.courseId))
        .where(eq(attendanceWindow.id, event.windowId))
      if (!row || row.window.kind !== 'start') return null
      const state = windowState(row.window, at)
      if (!state.open) return null
      const [ids, done] = await Promise.all([
        rosterIds(db, row.courseId),
        db.select({ id: attendanceCheckIn.studentId }).from(attendanceCheckIn).where(eq(attendanceCheckIn.windowId, row.window.id)),
      ])
      const checkedIn = new Set(done.map((d) => d.id))
      return {
        kind: 'checkinOpen',
        preference: 'checkin',
        userIds: ids.filter((id) => !checkedIn.has(id)),
        template: (locale) => buildTemplate('checkinOpen', { courseTitle: row.courseTitle, closesAt: state.closesAt }, locale),
      }
    }
    case 'testStarted': {
      const [row] = await db
        .select({ test: courseTest, courseTitle: course.title })
        .from(courseTest)
        .innerJoin(course, eq(course.id, courseTest.courseId))
        .where(eq(courseTest.id, event.testId))
      if (!row || testPhase(row.test, at) !== 'running') return null
      const [ids, attempts] = await Promise.all([
        rosterIds(db, row.test.courseId),
        db.select({ id: testAttempt.studentId }).from(testAttempt).where(eq(testAttempt.testId, row.test.id)),
      ])
      const joined = new Set(attempts.map((a) => a.id))
      return {
        kind: 'testStarted',
        preference: 'tests',
        userIds: ids.filter((id) => !joined.has(id)),
        template: (locale) =>
          buildTemplate('testStarted', { testTitle: row.test.title, courseTitle: row.courseTitle, code: row.test.code }, locale),
      }
    }
    case 'resultsReleased': {
      if (event.source === 'assignment') {
        const [row] = await db
          .select({ a: assignment, courseTitle: course.title })
          .from(assignment)
          .innerJoin(course, eq(course.id, assignment.courseId))
          .where(eq(assignment.id, event.id))
        if (!row || row.a.gradesReleasedAt === null) return null
        const [ids, graded] = await Promise.all([
          rosterIds(db, row.a.courseId),
          db
            .select({ id: submission.studentId })
            .from(submission)
            .where(and(eq(submission.assignmentId, row.a.id), isNotNull(submission.mark))),
        ])
        const hasMark = new Set(graded.map((g) => g.id))
        return {
          kind: 'resultsReleased',
          preference: 'results',
          userIds: ids.filter((id) => hasMark.has(id)),
          template: (locale) =>
            buildTemplate(
              'resultsReleased',
              { source: 'assignment', itemTitle: row.a.title, courseTitle: row.courseTitle, assignmentId: row.a.id },
              locale,
            ),
        }
      }
      const [row] = await db
        .select({ test: courseTest, courseTitle: course.title })
        .from(courseTest)
        .innerJoin(course, eq(course.id, courseTest.courseId))
        .where(eq(courseTest.id, event.id))
      if (!row || row.test.resultsReleasedAt === null) return null
      const [ids, attempts] = await Promise.all([
        rosterIds(db, row.test.courseId),
        db.select({ id: testAttempt.studentId }).from(testAttempt).where(eq(testAttempt.testId, row.test.id)),
      ])
      const joined = new Set(attempts.map((a) => a.id))
      return {
        kind: 'resultsReleased',
        preference: 'results',
        userIds: ids.filter((id) => joined.has(id)),
        template: (locale) =>
          buildTemplate(
            'resultsReleased',
            { source: 'test', itemTitle: row.test.title, courseTitle: row.courseTitle, code: row.test.code },
            locale,
          ),
      }
    }
    case 'assignmentPublished': {
      const [row] = await db
        .select({ a: assignment, courseTitle: course.title })
        .from(assignment)
        .innerJoin(course, eq(course.id, assignment.courseId))
        .where(eq(assignment.id, event.assignmentId))
      if (!row || row.a.status !== 'published') return null
      return {
        kind: 'assignmentPublished',
        preference: 'assignments',
        userIds: await rosterIds(db, row.a.courseId),
        template: (locale) =>
          buildTemplate(
            'assignmentPublished',
            { courseTitle: row.courseTitle, assignmentTitle: row.a.title, dueAt: row.a.dueAt, assignmentId: row.a.id },
            locale,
          ),
      }
    }
    case 'classSoonLecturer': {
      const [row] = await db
        .select({ title: course.title, lecturerId: course.lecturerId })
        .from(course)
        .where(eq(course.id, event.courseId))
      if (!row) return null
      const startsAt = new Date(event.startsAt)
      if (Number.isNaN(startsAt.getTime())) return null
      return {
        kind: 'classSoonLecturer',
        preference: 'classSoon',
        userIds: [row.lecturerId],
        template: (locale) =>
          buildTemplate('classSoonLecturer', { courseTitle: row.title, startsAt, sittingKey: event.sittingKey }, locale),
      }
    }
  }
}

type Recipient = { userId: string; phone: string; locale: Locale }

/** Of these users, the ones with a linked, allowed number and the preference on (no preference row means on). */
async function recipientsOf(db: Db, userIds: string[], preference: PreferenceColumn): Promise<Recipient[]> {
  if (userIds.length === 0) return []
  const [rows, locales] = await Promise.all([
    db
      .select({ userId: whatsappLink.userId, phone: whatsappLink.phone, preferences: whatsappPreference })
      .from(whatsappLink)
      .leftJoin(whatsappPreference, eq(whatsappPreference.userId, whatsappLink.userId))
      .innerJoin(user, eq(user.id, whatsappLink.userId))
      .where(inArray(whatsappLink.userId, userIds)),
    localesOf(db, userIds),
  ])
  return rows
    .filter((r) => (r.preferences?.[preference] ?? true) && isAllowedWhatsAppNumber(r.phone))
    .map((r) => ({ userId: r.userId, phone: r.phone, locale: locales.get(r.userId) ?? 'en' }))
}

/**
 * True for a send failure that a later attempt can fix: throttling, a 5xx, a timeout or network error, or a
 * credential problem while signing in (OIDC, STS, IAM). Anything else (a validation error, another 4xx) is final.
 */
export function isRetryableSendError(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) return false
  const e = error as {
    name?: unknown
    code?: unknown
    message?: unknown
    $retryable?: unknown
    $metadata?: { httpStatusCode?: unknown }
  }
  const name = typeof e.name === 'string' ? e.name : ''
  const code = typeof e.code === 'string' ? e.code : ''
  if (e.$retryable) return true
  const status = e.$metadata?.httpStatusCode
  if (typeof status === 'number' && status >= 500) return true
  const retryableNames = [
    'ThrottlingException',
    'TooManyRequestsException',
    'InternalServiceException',
    'ServiceUnavailableException',
    'TimeoutError',
    'AbortError',
    'RequestTimeout',
    'CredentialsProviderError',
    'ExpiredToken',
    'ExpiredTokenException',
    'AccessDenied',
    'AccessDeniedException',
    'InvalidIdentityToken',
    'IDPCommunicationError',
  ]
  if (retryableNames.includes(name) || retryableNames.includes(code)) return true
  if (/^E(CONNRESET|CONNREFUSED|TIMEDOUT|NOTFOUND|AI_AGAIN|PIPE|HOSTUNREACH)$/.test(code)) return true
  const message = typeof e.message === 'string' ? e.message : ''
  return /\b(timed out|timeout|socket hang up|ExpiredToken)\b/i.test(message)
}

/** Plain, short English email to each admin: the month's cap has been reached. */
async function mailCapReached(at: Date, cap: number): Promise<void> {
  const month = at.toISOString().slice(0, 7)
  const body = `The WhatsApp monthly cap of ${cap} messages was reached in ${month}. Further alerts this month are skipped (urgent check-in and test alerts may still go until the cap itself is used up). Students still get Web Push and email.`
  const react = createElement(Html, { lang: 'en' }, createElement(Text, null, body))
  for (const to of adminEmails()) {
    try {
      await sendEmail({ to, subject: 'WhatsApp monthly cap reached', react, kind: 'whatsappCapReached' })
    } catch (error) {
      console.error('[whatsapp] could not email the cap notice', { error: scrubError(String(error)) })
    }
  }
}

/**
 * Stop starting new batches after this long; the queue then retries and only the students not yet logged are left.
 * A batch can take about 16 s (8 s timeout, two attempts), so 35 s keeps the last batch inside the 60 s limit.
 */
const TIME_BUDGET_MS = 35_000

export type DispatchOptions = {
  /** Recipients handled at once. */
  batchSize?: number
  /** How long the event may run before it stops and throws so the queue retries it. */
  budgetMs?: number
  /** Milliseconds clock; tests inject their own. */
  clock?: () => number
}

/**
 * Delivers one queued event: works out, as of `at`, who still needs a message and sends each of them the
 * approved template. One message per (student, event), so a redelivered event sends nothing new. A permanent
 * provider failure is logged against that student and never stops the others; a temporary one (throttling, 5xx,
 * timeout, credentials), a database error, or running out of time throws after the current batch so the queue
 * retries (students already logged are skipped, the rest are sent).
 */
export async function handleWhatsAppEvent(
  db: Db,
  event: WhatsAppEvent,
  at: Date,
  options: DispatchOptions = {},
): Promise<{ sent: number; skipped: number }> {
  const { batchSize = BATCH, budgetMs = TIME_BUDGET_MS, clock = Date.now } = options
  const startedAt = clock()
  const config = whatsAppConfig()
  const provider = whatsAppProvider()
  if (!config || !provider) return { sent: 0, skipped: 0 }
  const plan = await planFor(db, event, at)
  if (!plan) return { sent: 0, skipped: 0 }
  const recipients = await recipientsOf(db, plan.userIds, plan.preference)
  const key = eventKey(event)
  const totals = { sent: 0, skipped: 0 }

  async function deliver(r: Recipient): Promise<void> {
    const template = plan!.template(r.locale)
    // The log row comes first: it is what makes a redelivery a no-op. It starts 'pending' and turns 'sent' only
    // with the provider's id. A crash around the provider call leaves it pending, which is better than a duplicate.
    const [row] = await db
      .insert(whatsappMessage)
      .values({ userId: r.userId, kind: plan!.kind, eventKey: key, template: template.name, status: 'pending' })
      .onConflictDoNothing({ target: [whatsappMessage.userId, whatsappMessage.eventKey] })
      .returning({ id: whatsappMessage.id })
    if (!row) return
    const setRow = (values: Partial<typeof whatsappMessage.$inferInsert>) =>
      db.update(whatsappMessage).set({ ...values, updatedAt: new Date() }).where(eq(whatsappMessage.id, row.id))
    /** The cap bookkeeping hit a database error before anything was sent: forget the row so the retry sends. */
    const forgetRow = async () => {
      try {
        await db.delete(whatsappMessage).where(eq(whatsappMessage.id, row.id))
      } catch (error) {
        console.error('[whatsapp] could not clear a pending message row', error)
      }
    }

    let claimed: boolean
    try {
      claimed = await claimSend(db, plan!.kind, at, config!.cap)
    } catch (error) {
      await forgetRow()
      throw error
    }
    if (!claimed) {
      await setRow({ status: 'skipped_cap' })
      totals.skipped += 1
      if (await noteCapReached(db, at)) await mailCapReached(at, config!.cap)
      return
    }
    let messageId: string
    try {
      messageId = (await provider!.sendTemplate(r.phone, template)).messageId
    } catch (error) {
      const message = scrubError(error instanceof Error ? error.message : String(error))
      const retryable = isRetryableSendError(error)
      console.error('[whatsapp] send failed', { kind: plan!.kind, template: template.name, retryable, error: message })
      try {
        await releaseClaim(db, at)
      } catch (releaseError) {
        await forgetRow()
        throw releaseError
      }
      if (retryable) {
        // Nothing reached the student: forget the row so the queue's retry sends to them.
        await forgetRow()
        throw error
      }
      await setRow({ status: 'failed', error: message })
      totals.skipped += 1
      return
    }
    await setRow({ status: 'sent', providerMessageId: messageId })
    totals.sent += 1
  }

  for (let i = 0; i < recipients.length; i += batchSize) {
    if (clock() - startedAt >= budgetMs) throw new Error('WhatsApp dispatch ran out of time; the queue will retry')
    const results = await Promise.allSettled(recipients.slice(i, i + batchSize).map(deliver))
    const failed = results.find((x): x is PromiseRejectedResult => x.status === 'rejected')
    if (failed) throw failed.reason
  }
  return totals
}
