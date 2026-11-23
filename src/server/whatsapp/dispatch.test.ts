import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { eq } from 'drizzle-orm'
import { setNowForTests } from '@/server/core/clock'
import type { Db } from '@/server/db'
import {
  assignment,
  courseTest,
  attendanceCheckIn,
  attendanceSession,
  attendanceWindow,
  submission,
  testCatchUpStudent,
  whatsappLink,
  whatsappMessage,
  whatsappMonthUsage,
  whatsappPreference,
} from '@/server/db/schema'
import { createTestDb } from '@/test/db'
import { at, insertStartedTest, joinTest, setupCourse, T0 } from '@/test/marking-fixture'
import { handleWhatsAppEvent, isRetryableSendError } from './dispatch'
import { enqueueWhatsApp, eventKey, setWhatsAppQueueForTests, type WhatsAppEvent } from './events'
import { setWhatsAppProviderForTests, type TemplateMessage } from './provider'

const sendEmail = vi.hoisted(() => vi.fn(async () => {}))
vi.mock('@/server/email/send', () => ({ sendEmail }))

const capFaults = vi.hoisted(() => ({ claim: false, release: false }))
vi.mock('./cap', async (importOriginal) => {
  const real = await importOriginal<typeof import('./cap')>()
  return {
    ...real,
    claimSend: async (...args: Parameters<typeof real.claimSend>) => {
      if (capFaults.claim) throw new Error('database unavailable')
      return real.claimSend(...args)
    },
    releaseClaim: async (...args: Parameters<typeof real.releaseClaim>) => {
      if (capFaults.release) throw new Error('database unavailable')
      return real.releaseClaim(...args)
    },
  }
})

type Sent = { to: string; msg: TemplateMessage }

let db: Db
let fx: Awaited<ReturnType<typeof setupCourse>>
let sent: Sent[]
let failFor: Set<string>
const phones = new Map<string, string>()

const phoneOf = (userId: string) => phones.get(userId)!

async function connect(...students: { user: { id: string } }[]) {
  for (const s of students) {
    const phone = `+2376000${String(phones.size + 1).padStart(5, '0')}`
    phones.set(s.user.id, phone)
    await db.insert(whatsappLink).values({ userId: s.user.id, phone })
  }
}

async function openWindow(kind: 'start' | 'end' = 'start', closedAt: Date | null = null) {
  const [session] = await db
    .insert(attendanceSession)
    .values({ courseId: fx.bio.id, createdBy: fx.lecturer.user.id })
    .returning()
  const [window] = await db
    .insert(attendanceWindow)
    .values({ sessionId: session.id, kind, secret: 's', openedAt: T0, closedAt, openedBy: fx.lecturer.user.id })
    .returning()
  return window
}

const messages = () => db.select().from(whatsappMessage)

beforeEach(async () => {
  vi.stubEnv('WHATSAPP_AWS_REGION', 'eu-west-1')
  vi.stubEnv('AWS_ACCESS_KEY_ID', 'AKIAEXAMPLE')
  vi.stubEnv('AWS_SECRET_ACCESS_KEY', 'secret-example')
  vi.stubEnv('WHATSAPP_PHONE_NUMBER_ID', 'phone-number-id-1')
  vi.stubEnv('WHATSAPP_DISPLAY_NUMBER', '+1 555 010 0000')
  vi.stubEnv('WHATSAPP_SNS_TOPIC_ARN', 'arn:aws:sns:eu-west-1:1:t')
  vi.stubEnv('WHATSAPP_ALLOWLIST', '')
  vi.stubEnv('WHATSAPP_MONTHLY_CAP', '')
  vi.stubEnv('ADMIN_EMAILS', 'boss@example.com')
  sendEmail.mockClear()
  capFaults.claim = false
  capFaults.release = false
  sent = []
  failFor = new Set()
  phones.clear()
  setWhatsAppProviderForTests({
    sendTemplate: async (to, msg) => {
      if (failFor.has(to)) throw new Error(`rejected ${to} (owner@example.com)`)
      sent.push({ to, msg })
      return { messageId: `wamid.${sent.length}` }
    },
    sendText: async () => ({ messageId: 'text' }),
  })
  db = await createTestDb()
  fx = await setupCourse(db)
}, 120_000)

afterEach(() => {
  vi.unstubAllEnvs()
  setWhatsAppProviderForTests(null)
  setWhatsAppQueueForTests(null)
  setNowForTests(null)
})

describe('handleWhatsAppEvent', () => {
  it('checkin fallback skips students who checked in during the delay', async () => {
    await connect(fx.alice, fx.bob)
    const w = await openWindow()
    await db.insert(attendanceCheckIn).values({ windowId: w.id, studentId: fx.alice.user.id, checkedInAt: at(2) })
    const result = await handleWhatsAppEvent(db, { kind: 'checkinOpen', windowId: w.id }, at(5))
    expect(result).toEqual({ sent: 1, skipped: 0 })
    expect(sent.map((s) => s.to)).toEqual([phoneOf(fx.bob.user.id)])
    expect(sent[0].msg).toMatchObject({ name: 'checkin_open', language: 'fr', bodyParams: ['Cell biology', '09:15'], buttonPath: 'check-in' })
  })

  it('checkin fallback sends nothing when the window was closed early', async () => {
    await connect(fx.alice)
    const w = await openWindow('start', at(3))
    const result = await handleWhatsAppEvent(db, { kind: 'checkinOpen', windowId: w.id }, at(5))
    expect(result).toEqual({ sent: 0, skipped: 0 })
    expect(sent).toEqual([])
    expect(await messages()).toEqual([])
  })

  it('checkin fallback sends nothing after the window ran out by itself', async () => {
    await connect(fx.alice)
    const w = await openWindow()
    await handleWhatsAppEvent(db, { kind: 'checkinOpen', windowId: w.id }, at(16))
    expect(sent).toEqual([])
  })

  it('checkin fallback ignores end windows', async () => {
    await connect(fx.alice)
    const w = await openWindow('end')
    await handleWhatsAppEvent(db, { kind: 'checkinOpen', windowId: w.id }, at(5))
    expect(sent).toEqual([])
  })

  it('test fallback skips students with an attempt', async () => {
    await connect(fx.alice, fx.carol)
    const { test } = await insertStartedTest(db, fx.lecturer, fx.bio.id)
    await joinTest(db, test.id, fx.alice)
    const result = await handleWhatsAppEvent(db, { kind: 'testStarted', testId: test.id }, at(5))
    expect(result).toEqual({ sent: 1, skipped: 0 })
    expect(sent.map((s) => s.to)).toEqual([phoneOf(fx.carol.user.id)])
    expect(sent[0].msg).toMatchObject({ name: 'test_started', bodyParams: ['CA 1', 'Cell biology'], buttonPath: `t/${test.code}` })
  })

  it('a catch-up for those who missed the test goes only to students with no attempt on the original', async () => {
    await connect(fx.alice, fx.carol)
    const { test: original } = await insertStartedTest(db, fx.lecturer, fx.bio.id)
    await joinTest(db, original.id, fx.alice)
    const { test } = await insertStartedTest(db, fx.lecturer, fx.bio.id)
    await db.update(courseTest).set({ catchUpOfId: original.id, catchUpFor: 'missed' }).where(eq(courseTest.id, test.id))
    const result = await handleWhatsAppEvent(db, { kind: 'testStarted', testId: test.id }, at(5))
    expect(result).toEqual({ sent: 1, skipped: 0 })
    expect(sent.map((s) => s.to)).toEqual([phoneOf(fx.carol.user.id)])
  })

  it('a catch-up for picked students goes only to them', async () => {
    await connect(fx.alice, fx.carol)
    const { test: original } = await insertStartedTest(db, fx.lecturer, fx.bio.id)
    const { test } = await insertStartedTest(db, fx.lecturer, fx.bio.id)
    await db.update(courseTest).set({ catchUpOfId: original.id, catchUpFor: 'picked' }).where(eq(courseTest.id, test.id))
    await db.insert(testCatchUpStudent).values({ testId: test.id, studentId: fx.alice.user.id, addedBy: fx.lecturer.user.id })
    await handleWhatsAppEvent(db, { kind: 'testStarted', testId: test.id }, at(5))
    expect(sent.map((s) => s.to)).toEqual([phoneOf(fx.alice.user.id)])
  })

  it('test fallback sends nothing once the test has ended', async () => {
    await connect(fx.alice)
    const { test } = await insertStartedTest(db, fx.lecturer, fx.bio.id)
    await handleWhatsAppEvent(db, { kind: 'testStarted', testId: test.id }, at(31))
    expect(sent).toEqual([])
  })

  it('redelivering the same event sends nothing new', async () => {
    await connect(fx.alice, fx.carol)
    const { test } = await insertStartedTest(db, fx.lecturer, fx.bio.id)
    const event: WhatsAppEvent = { kind: 'testStarted', testId: test.id }
    expect(await handleWhatsAppEvent(db, event, at(5))).toEqual({ sent: 2, skipped: 0 })
    expect(await handleWhatsAppEvent(db, event, at(6))).toEqual({ sent: 0, skipped: 0 })
    expect(sent).toHaveLength(2)
    const rows = await messages()
    expect(rows).toHaveLength(2)
    expect(rows.every((r) => r.status === 'sent' && r.providerMessageId && r.eventKey === eventKey(event))).toBe(true)
    const [usage] = await db.select().from(whatsappMonthUsage)
    expect(usage.sent).toBe(2)
  })

  it('students with the preference off, or not connected, get nothing', async () => {
    await connect(fx.alice, fx.bob)
    await db.insert(whatsappPreference).values({ userId: fx.alice.user.id, tests: false })
    // Carol is not connected; Bob only switched off something else.
    await db.insert(whatsappPreference).values({ userId: fx.bob.user.id, assignments: false })
    const { test } = await insertStartedTest(db, fx.lecturer, fx.bio.id)
    await handleWhatsAppEvent(db, { kind: 'testStarted', testId: test.id }, at(5))
    expect(sent.map((s) => s.to)).toEqual([phoneOf(fx.bob.user.id)])
  })

  it('numbers outside the allowlist get nothing', async () => {
    await connect(fx.alice, fx.carol)
    vi.stubEnv('WHATSAPP_ALLOWLIST', phoneOf(fx.carol.user.id))
    const { test } = await insertStartedTest(db, fx.lecturer, fx.bio.id)
    await handleWhatsAppEvent(db, { kind: 'testStarted', testId: test.id }, at(5))
    expect(sent.map((s) => s.to)).toEqual([phoneOf(fx.carol.user.id)])
  })

  it('a provider failure for one student still sends to the others and frees the cap slot', async () => {
    await connect(fx.alice, fx.bob, fx.carol)
    failFor.add(phoneOf(fx.bob.user.id))
    const { test } = await insertStartedTest(db, fx.lecturer, fx.bio.id)
    const result = await handleWhatsAppEvent(db, { kind: 'testStarted', testId: test.id }, at(5))
    expect(result).toEqual({ sent: 2, skipped: 1 })
    expect(sent.map((s) => s.to).sort()).toEqual([phoneOf(fx.alice.user.id), phoneOf(fx.carol.user.id)].sort())
    const [failed] = await db.select().from(whatsappMessage).where(eq(whatsappMessage.userId, fx.bob.user.id))
    expect(failed.status).toBe('failed')
    expect(failed.error).toContain('rejected')
    expect(failed.error).not.toContain('owner@example.com')
    const [usage] = await db.select().from(whatsappMonthUsage)
    expect(usage.sent).toBe(2)
  })

  it('at the cap the message is logged skipped_cap and admins are emailed once', async () => {
    vi.stubEnv('WHATSAPP_MONTHLY_CAP', '1')
    await connect(fx.alice, fx.bob, fx.carol)
    const w = await openWindow()
    const result = await handleWhatsAppEvent(db, { kind: 'checkinOpen', windowId: w.id }, at(5))
    expect(result).toEqual({ sent: 1, skipped: 2 })
    expect((await messages()).filter((r) => r.status === 'skipped_cap')).toHaveLength(2)
    expect(sendEmail).toHaveBeenCalledTimes(1)
    expect(sendEmail).toHaveBeenCalledWith(
      expect.objectContaining({ to: 'boss@example.com', subject: 'WhatsApp monthly cap reached', kind: 'whatsappCapReached' }),
    )
    // Another event the same month hits the cap again but does not email again.
    const { test } = await insertStartedTest(db, fx.lecturer, fx.bio.id)
    await handleWhatsAppEvent(db, { kind: 'testStarted', testId: test.id }, at(6))
    expect(sendEmail).toHaveBeenCalledTimes(1)
  })

  it('results for an assignment use the assignment path and the student\'s locale', async () => {
    await connect(fx.alice, fx.bob)
    const [a] = await db
      .insert(assignment)
      .values({
        courseId: fx.bio.id,
        title: 'Devoir 1',
        dueAt: at(60),
        maxMark: 20,
        submissionMode: 'text',
        status: 'published',
        publishedAt: T0,
        gradesReleasedAt: at(2),
        createdBy: fx.lecturer.user.id,
      })
      .returning()
    for (const s of [fx.alice, fx.bob]) {
      await db.insert(submission).values({ assignmentId: a.id, studentId: s.user.id, submittedAt: at(1), mark: 12 })
    }
    await handleWhatsAppEvent(db, { kind: 'resultsReleased', source: 'assignment', id: a.id }, at(5))
    const byTo = new Map(sent.map((s) => [s.to, s.msg]))
    expect(byTo.get(phoneOf(fx.alice.user.id))).toMatchObject({
      name: 'results_released',
      language: 'en',
      bodyParams: ['Devoir 1', 'Cell biology'],
      buttonPath: `assignments/${a.id}`,
    })
    expect(byTo.get(phoneOf(fx.bob.user.id))?.language).toBe('fr')
  })

  it('results for a test go to students who took it, at the test path', async () => {
    await connect(fx.alice, fx.carol)
    const { test } = await insertStartedTest(db, fx.lecturer, fx.bio.id)
    await joinTest(db, test.id, fx.alice)
    await db.update(courseTest).set({ resultsReleasedAt: at(40) })
    await handleWhatsAppEvent(db, { kind: 'resultsReleased', source: 'test', id: test.id }, at(45))
    expect(sent).toHaveLength(1)
    expect(sent[0]).toMatchObject({ to: phoneOf(fx.alice.user.id), msg: { buttonPath: `t/${test.code}`, bodyParams: ['CA 1', 'Cell biology'] } })
  })

  it('a published assignment goes to the roster with its due date', async () => {
    await connect(fx.alice)
    const [a] = await db
      .insert(assignment)
      .values({
        courseId: fx.bio.id,
        title: 'Essay',
        dueAt: new Date('2026-11-16T13:30:00Z'),
        maxMark: 20,
        submissionMode: 'text',
        status: 'published',
        publishedAt: T0,
        createdBy: fx.lecturer.user.id,
      })
      .returning()
    await handleWhatsAppEvent(db, { kind: 'assignmentPublished', assignmentId: a.id }, at(5))
    expect(sent[0].msg).toMatchObject({ name: 'assignment_published', buttonPath: `assignments/${a.id}` })
    expect(sent[0].msg.bodyParams[2]).toMatch(/14:30/)
  })

  it('a class starting soon goes to the course lecturer', async () => {
    await connect(fx.lecturer)
    const result = await handleWhatsAppEvent(
      db,
      { kind: 'classSoonLecturer', courseId: fx.bio.id, sittingKey: 'slot-1:2026-11-16', startsAt: '2026-11-16T13:30:00.000Z' },
      at(5),
    )
    expect(result).toEqual({ sent: 1, skipped: 0 })
    expect(sent[0]).toMatchObject({
      to: phoneOf(fx.lecturer.user.id),
      msg: { name: 'class_soon_lecturer', bodyParams: ['Cell biology', '14:30'], buttonPath: 'schedule/class/slot-1%3A2026-11-16' },
    })
  })

  it('a db error while claiming leaves the student retryable', async () => {
    await connect(fx.alice)
    const { test } = await insertStartedTest(db, fx.lecturer, fx.bio.id)
    const event: WhatsAppEvent = { kind: 'testStarted', testId: test.id }
    capFaults.claim = true
    await expect(handleWhatsAppEvent(db, event, at(5))).rejects.toThrow('database unavailable')
    expect(await messages()).toEqual([])
    expect(sent).toEqual([])
    capFaults.claim = false
    expect(await handleWhatsAppEvent(db, event, at(6))).toEqual({ sent: 1, skipped: 0 })
    expect((await messages())[0]).toMatchObject({ status: 'sent' })
  })

  it('a db error while releasing a failed send leaves the student retryable', async () => {
    await connect(fx.alice)
    failFor.add(phoneOf(fx.alice.user.id))
    const { test } = await insertStartedTest(db, fx.lecturer, fx.bio.id)
    const event: WhatsAppEvent = { kind: 'testStarted', testId: test.id }
    capFaults.release = true
    await expect(handleWhatsAppEvent(db, event, at(5))).rejects.toThrow('database unavailable')
    expect(await messages()).toEqual([])
    capFaults.release = false
    failFor.clear()
    expect(await handleWhatsAppEvent(db, event, at(6))).toEqual({ sent: 1, skipped: 0 })
  })

  it('a throttled send leaves the student retryable and the event throws after the batch', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    await connect(fx.alice, fx.bob)
    const throttled = phoneOf(fx.alice.user.id)
    setWhatsAppProviderForTests({
      sendTemplate: async (to, msg) => {
        if (to === throttled) throw Object.assign(new Error('Rate exceeded'), { name: 'ThrottlingException' })
        sent.push({ to, msg })
        return { messageId: `wamid.${sent.length}` }
      },
      sendText: async () => ({ messageId: 'text' }),
    })
    const { test } = await insertStartedTest(db, fx.lecturer, fx.bio.id)
    const event: WhatsAppEvent = { kind: 'testStarted', testId: test.id }
    await expect(handleWhatsAppEvent(db, event, at(5))).rejects.toThrow('Rate exceeded')
    // The other student in the batch was still sent; the throttled one has no row and no cap slot.
    expect(sent.map((x) => x.to)).toEqual([phoneOf(fx.bob.user.id)])
    expect((await messages()).map((m) => [m.userId, m.status])).toEqual([[fx.bob.user.id, 'sent']])
    const [usage] = await db.select().from(whatsappMonthUsage)
    expect(usage.sent).toBe(1)
    setWhatsAppProviderForTests({
      sendTemplate: async (to, msg) => {
        sent.push({ to, msg })
        return { messageId: `wamid.${sent.length}` }
      },
      sendText: async () => ({ messageId: 'text' }),
    })
    expect(await handleWhatsAppEvent(db, event, at(6))).toEqual({ sent: 1, skipped: 0 })
    expect(sent.map((x) => x.to).sort()).toEqual([phoneOf(fx.alice.user.id), phoneOf(fx.bob.user.id)].sort())
  })

  it('a validation error marks the student failed and does not throw', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    await connect(fx.alice)
    setWhatsAppProviderForTests({
      sendTemplate: async () => {
        throw Object.assign(new Error('Invalid parameter'), { name: 'ValidationException', $metadata: { httpStatusCode: 400 } })
      },
      sendText: async () => ({ messageId: 'text' }),
    })
    const { test } = await insertStartedTest(db, fx.lecturer, fx.bio.id)
    expect(await handleWhatsAppEvent(db, { kind: 'testStarted', testId: test.id }, at(5))).toEqual({ sent: 0, skipped: 1 })
    expect((await messages())[0]).toMatchObject({ status: 'failed' })
  })

  it('classifies retryable and permanent send errors', () => {
    const named = (name: string, extra: object = {}) => Object.assign(new Error(name), { name, ...extra })
    expect(isRetryableSendError(named('ThrottlingException'))).toBe(true)
    expect(isRetryableSendError(named('InternalServiceException'))).toBe(true)
    expect(isRetryableSendError(named('Whatever', { $retryable: { throttling: false } }))).toBe(true)
    expect(isRetryableSendError(named('Whatever', { $metadata: { httpStatusCode: 503 } }))).toBe(true)
    expect(isRetryableSendError(named('TimeoutError'))).toBe(true)
    expect(isRetryableSendError(named('CredentialsProviderError'))).toBe(true)
    expect(isRetryableSendError(named('AccessDenied'))).toBe(true)
    expect(isRetryableSendError(Object.assign(new Error('x'), { code: 'ECONNRESET' }))).toBe(true)
    expect(isRetryableSendError(named('ValidationException', { $metadata: { httpStatusCode: 400 } }))).toBe(false)
    expect(isRetryableSendError(new Error('rejected'))).toBe(false)
    expect(isRetryableSendError('boom')).toBe(false)
  })

  it('a message is pending until the provider accepts it', async () => {
    await connect(fx.alice)
    let during: string | undefined
    setWhatsAppProviderForTests({
      sendTemplate: async () => {
        during = (await messages())[0]?.status
        return { messageId: 'wamid.p' }
      },
      sendText: async () => ({ messageId: 'text' }),
    })
    const { test } = await insertStartedTest(db, fx.lecturer, fx.bio.id)
    await handleWhatsAppEvent(db, { kind: 'testStarted', testId: test.id }, at(5))
    expect(during).toBe('pending')
    expect((await messages())[0]).toMatchObject({ status: 'sent', providerMessageId: 'wamid.p' })
  })

  it('the time budget stops starting new batches', async () => {
    await connect(fx.alice, fx.bob, fx.carol)
    let ms = 0
    setWhatsAppProviderForTests({
      sendTemplate: async (to, msg) => {
        sent.push({ to, msg })
        ms += 30_000
        return { messageId: `wamid.${sent.length}` }
      },
      sendText: async () => ({ messageId: 'text' }),
    })
    const { test } = await insertStartedTest(db, fx.lecturer, fx.bio.id)
    const event: WhatsAppEvent = { kind: 'testStarted', testId: test.id }
    const options = { batchSize: 1, budgetMs: 35_000, clock: () => ms }
    await expect(handleWhatsAppEvent(db, event, at(5), options)).rejects.toThrow('ran out of time')
    expect(sent).toHaveLength(2)
    // The retry sends only to the student who was not reached.
    expect(await handleWhatsAppEvent(db, event, at(6), options)).toEqual({ sent: 1, skipped: 0 })
    expect(new Set(sent.map((s) => s.to)).size).toBe(3)
    expect(sent).toHaveLength(3)
  })

  it('does nothing when WhatsApp is not set up', async () => {
    await connect(fx.alice)
    vi.stubEnv('WHATSAPP_AWS_REGION', '')
    setWhatsAppProviderForTests(null)
    const { test } = await insertStartedTest(db, fx.lecturer, fx.bio.id)
    expect(await handleWhatsAppEvent(db, { kind: 'testStarted', testId: test.id }, at(5))).toEqual({ sent: 0, skipped: 0 })
  })
})

describe('enqueueWhatsApp', () => {
  it('hands the event and delivery time to the queue', async () => {
    const queued: { event: WhatsAppEvent; deliverAt: Date }[] = []
    setWhatsAppQueueForTests({ send: async (event, deliverAt) => void queued.push({ event, deliverAt }) })
    const when = new Date('2026-11-16T09:00:00Z')
    await enqueueWhatsApp({ kind: 'checkinOpen', windowId: 'w1' }, when)
    expect(queued).toEqual([{ event: { kind: 'checkinOpen', windowId: 'w1' }, deliverAt: when }])
  })

  it('does nothing when WhatsApp is not set up', async () => {
    const queued: unknown[] = []
    setWhatsAppQueueForTests({ send: async (e) => void queued.push(e) })
    vi.stubEnv('WHATSAPP_SNS_TOPIC_ARN', '')
    await enqueueWhatsApp({ kind: 'testStarted', testId: 't1' })
    expect(queued).toEqual([])
  })

  it('names each event with a stable key', () => {
    expect(eventKey({ kind: 'checkinOpen', windowId: 'w' })).toBe('checkin:w')
    expect(eventKey({ kind: 'testStarted', testId: 't' })).toBe('test:t')
    expect(eventKey({ kind: 'resultsReleased', source: 'test', id: 'x' })).toBe('results:test:x')
    expect(eventKey({ kind: 'assignmentPublished', assignmentId: 'a' })).toBe('assignment:a')
    expect(eventKey({ kind: 'classSoonLecturer', courseId: 'c', sittingKey: 'k', startsAt: 's' })).toBe('class:k')
  })
})
