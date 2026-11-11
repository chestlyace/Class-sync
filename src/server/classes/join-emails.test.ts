import type { ReactElement } from 'react'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Db } from '@/server/db'
import { class_, classLecturer, classStudent, school } from '@/server/db/schema'
import { setEmailDbForTests } from '@/server/email/db'
import { setResendClientFactoryForTests, setRetryWaitForTests, type NotifyClient } from '@/server/email/notify'
import { setAfterResponseForTests } from '@/server/lib/after-response'
import { createSchool } from '@/server/schools/service'
import { createTestDb } from '@/test/db'
import { ctxFor, makeUser } from '@/test/factories'
import { createClass, joinClassAsLecturer, joinClassAsStudent, removeStudentFromClass } from './service'

type Sent = { to: string; subject: string; react: ReactElement<Record<string, unknown>> }

describe('class join confirmation emails', () => {
  let db: Db
  let tasks: Array<() => Promise<void>>
  let sent: Sent[]

  beforeAll(async () => {
    db = await createTestDb()
  })
  beforeEach(() => {
    tasks = []
    sent = []
    setAfterResponseForTests((task) => {
      tasks.push(task)
    })
    const client: NotifyClient = {
      batch: {
        send: async (payload) => {
          sent.push(...(payload as Sent[]))
          return { error: null }
        },
      },
    }
    setEmailDbForTests(db)
    setResendClientFactoryForTests(() => client)
    setRetryWaitForTests(async () => {})
    vi.stubEnv('RESEND_API_KEY', 're_test')
    vi.stubEnv('BETTER_AUTH_URL', 'https://clasync.test/')
  })
  afterEach(async () => {
    setAfterResponseForTests(null)
    setEmailDbForTests(null)
    setResendClientFactoryForTests(null)
    setRetryWaitForTests(null)
    vi.unstubAllEnvs()
    vi.restoreAllMocks()
    await db.delete(classStudent)
    await db.delete(classLecturer)
    await db.delete(class_)
    await db.delete(school)
  })

  async function flush() {
    const pending = tasks.splice(0)
    for (const task of pending) await task()
  }

  async function setup() {
    const owner = ctxFor(db, await makeUser(db, { role: 'lecturer', name: 'Dr Owner', locale: 'fr' }))
    const sch = await createSchool(owner, { name: 'University of Buea', town: 'Buea' })
    const cls = await createClass(owner, { schoolId: sch.id, name: 'CS L3', academicYear: '2026/27' })
    return { owner, cls }
  }

  it('a student who joins gets a confirmation in their language with the dashboard link, after the response', async () => {
    const { cls } = await setup()
    const ada = ctxFor(db, await makeUser(db, { role: 'student', name: 'Ada', locale: 'fr' }))

    await joinClassAsStudent(ada, cls.studentCode!, 'UB1')
    expect(sent).toHaveLength(0) // only after the response
    await flush()

    // To the student only: lecturers are never emailed for a student join.
    expect(sent).toHaveLength(1)
    const [m] = sent
    expect(m.to).toBe(ada.user.email)
    expect(m.subject).toBe('Vous avez rejoint CS L3 (University of Buea)')
    expect(m.react.props).toMatchObject({
      locale: 'fr',
      studentName: 'Ada',
      className: 'CS L3',
      schoolName: 'University of Buea',
      url: 'https://clasync.test/dashboard',
    })
  })

  it('joining again while active sends nothing; coming back after removal sends a new confirmation', async () => {
    const { owner, cls } = await setup()
    const ada = ctxFor(db, await makeUser(db, { role: 'student', name: 'Ada' }))
    await joinClassAsStudent(ada, cls.studentCode!, 'UB1')
    await flush()
    expect(sent).toHaveLength(1)

    await joinClassAsStudent(ada, cls.studentCode!, 'UB1')
    await flush()
    expect(sent).toHaveLength(1)

    await removeStudentFromClass(owner, cls.id, ada.user.id)
    await joinClassAsStudent(ada, cls.studentCode!, 'UB1')
    await flush()
    expect(sent).toHaveLength(2)
    expect(sent[1].subject).toBe("You've joined CS L3 at University of Buea")
  })

  it('a failed join (unknown code, taken matricule) sends nothing', async () => {
    const { cls } = await setup()
    const ada = ctxFor(db, await makeUser(db, { role: 'student', name: 'Ada' }))
    const ben = ctxFor(db, await makeUser(db, { role: 'student', name: 'Ben' }))
    await expect(joinClassAsStudent(ada, 'ZZZZZZ', 'UB1')).rejects.toMatchObject({ code: 'NOT_FOUND' })
    await joinClassAsStudent(ada, cls.studentCode!, 'UB1')
    tasks.splice(0)
    await expect(joinClassAsStudent(ben, cls.studentCode!, 'UB1')).rejects.toMatchObject({ code: 'CONFLICT' })
    expect(tasks).toHaveLength(0)
  })

  it('a lecturer who joins gets a confirmation and every other lecturer of the class is told, each in their language', async () => {
    const { owner, cls } = await setup()
    const first = ctxFor(db, await makeUser(db, { role: 'lecturer', name: 'Dr First', locale: 'en' }))
    await joinClassAsLecturer(first, cls.lecturerCode!)
    await flush()
    expect(sent.map((m) => m.to).sort()).toEqual([first.user.email, owner.user.email].sort())
    sent = []

    const second = ctxFor(db, await makeUser(db, { role: 'lecturer', name: 'Dr Second', locale: 'fr' }))
    const { classId } = await joinClassAsLecturer(second, cls.lecturerCode!)
    expect(sent).toHaveLength(0)
    await flush()

    const url = `https://clasync.test/classes/${classId}`
    expect(sent.map((m) => m.to).sort()).toEqual([second.user.email, owner.user.email, first.user.email].sort())
    const toSecond = sent.find((m) => m.to === second.user.email)!
    expect(toSecond.subject).toBe('Vous enseignez maintenant en CS L3 (University of Buea)')
    expect(toSecond.react.props).toMatchObject({ locale: 'fr', lecturerName: 'Dr Second', url })
    const toOwner = sent.find((m) => m.to === owner.user.email)!
    expect(toOwner.subject).toBe('Dr Second a rejoint CS L3')
    expect(toOwner.react.props).toMatchObject({ locale: 'fr', recipientName: 'Dr Owner', colleagueName: 'Dr Second', url })
    const toFirst = sent.find((m) => m.to === first.user.email)!
    expect(toFirst.subject).toBe('Dr Second joined CS L3')
    expect(toFirst.react.props).toMatchObject({ locale: 'en', recipientName: 'Dr First' })
  })

  it('the class creator is told even when no longer a lecturer row of the class', async () => {
    const { owner, cls } = await setup()
    await db.delete(classLecturer)
    const first = ctxFor(db, await makeUser(db, { role: 'lecturer', name: 'Dr First' }))
    await joinClassAsLecturer(first, cls.lecturerCode!)
    await flush()
    expect(sent.map((m) => m.to).sort()).toEqual([first.user.email, owner.user.email].sort())
  })

  it('joining again as a lecturer emails nobody, and a wrong code emails nobody', async () => {
    const { owner, cls } = await setup()
    await joinClassAsLecturer(owner, cls.lecturerCode!) // the creator is already a lecturer
    const first = ctxFor(db, await makeUser(db, { role: 'lecturer', name: 'Dr First' }))
    await expect(joinClassAsLecturer(first, cls.studentCode!)).rejects.toMatchObject({ code: 'NOT_FOUND' })
    expect(tasks).toHaveLength(0)
  })

  it('a provider outage never fails the join', async () => {
    const { cls } = await setup()
    vi.spyOn(console, 'error').mockImplementation(() => {})
    setResendClientFactoryForTests(() => ({
      batch: {
        send: async () => {
          throw new Error('down')
        },
      },
    }))
    const ada = ctxFor(db, await makeUser(db, { role: 'student', name: 'Ada' }))
    const lect = ctxFor(db, await makeUser(db, { role: 'lecturer', name: 'Dr Lect' }))
    expect(await joinClassAsStudent(ada, cls.studentCode!, 'UB1')).toEqual({ classId: cls.id })
    expect(await joinClassAsLecturer(lect, cls.lecturerCode!)).toEqual({ classId: cls.id })
    await expect(flush()).resolves.toBeUndefined()
    expect(sent).toHaveLength(0)
  })
})
