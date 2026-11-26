import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { eq } from 'drizzle-orm'
import type { Db } from '@/server/db'
import { class_, classLecturer, course, courseClassroom, school } from '@/server/db/schema'
import { createClass } from '@/server/classes/service'
import { createCourse } from '@/server/courses/service'
import { createSchool } from '@/server/schools/service'
import { createTestDb } from '@/test/db'
import { ctxFor, makeUser } from '@/test/factories'
import { googleMeetAccess, googleMeetAccessToken } from '@/server/auth/google-meet-access'
import {
  assertClassroomUsable,
  type Classroom,
  createClassroom,
  getClassroom,
  setMeetSpaceMakerForTests,
} from './classroom'
import { MeetPermissionError, type MeetSpace } from './meet-api'

vi.mock('@/server/auth/google-meet-access', () => ({
  googleMeetAccess: vi.fn(),
  googleMeetAccessToken: vi.fn(),
}))

vi.mock('@/server/push/send', () => ({
  sendPush: vi.fn(async () => ({ sent: 0, skipped: 0, failed: 0, removed: 0 })),
  queuePush: vi.fn(async () => {}),
}))

const accessMock = vi.mocked(googleMeetAccess)
const tokenMock = vi.mocked(googleMeetAccessToken)

describe('course classroom', () => {
  let db: Db
  let spaceCount = 0
  const maker = vi.fn(async (): Promise<MeetSpace> => {
    spaceCount += 1
    return {
      spaceName: `spaces/s${spaceCount}`,
      meetingUrl: `https://meet.google.com/aaa-bbbb-c${spaceCount}`,
      meetingCode: `aaa-bbbb-c${spaceCount}`,
      knockingConfirmed: true,
    }
  })

  beforeAll(async () => {
    db = await createTestDb()
  })

  beforeEach(() => {
    spaceCount = 0
    vi.stubEnv('MEET_CLASSROOM', 'everyone')
    vi.stubEnv('ADMIN_EMAILS', '')
    accessMock.mockResolvedValue({ accountId: 'acc-1', granted: true })
    tokenMock.mockResolvedValue('token-1')
    maker.mockClear()
    setMeetSpaceMakerForTests(maker)
  })

  afterEach(async () => {
    vi.unstubAllEnvs()
    setMeetSpaceMakerForTests(null)
    accessMock.mockReset()
    tokenMock.mockReset()
    await db.delete(courseClassroom)
    await db.delete(course)
    await db.delete(classLecturer)
    await db.delete(class_)
    await db.delete(school)
  })

  async function setup() {
    const owner = ctxFor(db, await makeUser(db, { role: 'lecturer' }))
    const sch = await createSchool(owner, { name: 'University of Buea', town: 'Buea' })
    const cls = await createClass(owner, { schoolId: sch.id, name: 'CS L3', academicYear: '2026/27' })
    const algo = await createCourse(owner, { classId: cls.id, title: 'Algorithms', semester: 1 })
    return { owner, courseId: algo.id }
  }

  async function rows(courseId: string) {
    return db.select().from(courseClassroom).where(eq(courseClassroom.courseId, courseId))
  }

  it('creates the classroom for the owner and records who and which Google account', async () => {
    const { owner, courseId } = await setup()
    const result = await createClassroom(owner, courseId)
    expect(result).toEqual({
      kind: 'ready',
      classroom: {
        meetingUrl: 'https://meet.google.com/aaa-bbbb-c1',
        meetingCode: 'aaa-bbbb-c1',
        knockingConfirmed: true,
        createdAt: expect.any(Date),
      },
    })
    expect(tokenMock).toHaveBeenCalledWith(owner.user.id, 'acc-1')
    expect(maker).toHaveBeenCalledWith('token-1')
    const [row] = await rows(courseId)
    expect(row).toMatchObject({
      spaceName: 'spaces/s1',
      googleAccountId: 'acc-1',
      createdBy: owner.user.id,
      knockingConfirmed: true,
    })
    expect(await getClassroom(db, courseId)).toEqual((result as { classroom: unknown }).classroom)
  })

  it('returns the same classroom on a second call without calling Google again', async () => {
    const { owner, courseId } = await setup()
    const first = await createClassroom(owner, courseId)
    const second = await createClassroom(owner, courseId)
    expect(second).toEqual(first)
    expect(maker).toHaveBeenCalledTimes(1)
    expect(await rows(courseId)).toHaveLength(1)
  })

  it('ends with one row and one shared link when two requests run at once', async () => {
    const { owner, courseId } = await setup()
    const [a, b] = await Promise.all([createClassroom(owner, courseId), createClassroom(owner, courseId)])
    expect(a.kind).toBe('ready')
    expect(b.kind).toBe('ready')
    expect((a as { classroom: Classroom }).classroom.meetingUrl).toBe(
      (b as { classroom: Classroom }).classroom.meetingUrl,
    )
    expect(await rows(courseId)).toHaveLength(1)
  })

  it('needs Google when there is no Google account', async () => {
    const { owner, courseId } = await setup()
    accessMock.mockResolvedValue(null)
    expect(await createClassroom(owner, courseId)).toEqual({ kind: 'needsGoogle' })
    expect(maker).not.toHaveBeenCalled()
    expect(await rows(courseId)).toHaveLength(0)
  })

  it('needs Google when the Meet permission was not granted', async () => {
    const { owner, courseId } = await setup()
    accessMock.mockResolvedValue({ accountId: 'acc-1', granted: false })
    expect(await createClassroom(owner, courseId)).toEqual({ kind: 'needsGoogle' })
    expect(tokenMock).not.toHaveBeenCalled()
    expect(await rows(courseId)).toHaveLength(0)
  })

  it('needs Google when the token is refused', async () => {
    const { owner, courseId } = await setup()
    tokenMock.mockRejectedValue(new MeetPermissionError('revoked'))
    expect(await createClassroom(owner, courseId)).toEqual({ kind: 'needsGoogle' })
    expect(maker).not.toHaveBeenCalled()
    expect(await rows(courseId)).toHaveLength(0)
  })

  it('needs Google when Meet refuses the call, for example stale scopes', async () => {
    const { owner, courseId } = await setup()
    maker.mockRejectedValueOnce(new MeetPermissionError('403'))
    expect(await createClassroom(owner, courseId)).toEqual({ kind: 'needsGoogle' })
    expect(await rows(courseId)).toHaveLength(0)
  })

  it('rethrows any other failure and saves nothing', async () => {
    const { owner, courseId } = await setup()
    maker.mockRejectedValueOnce(new Error('Google Meet API error (500)'))
    await expect(createClassroom(owner, courseId)).rejects.toThrow('Google Meet API error (500)')
    expect(await rows(courseId)).toHaveLength(0)
  })

  it('refuses anyone who is not the course owner, before touching Google', async () => {
    const { courseId } = await setup()
    const other = ctxFor(db, await makeUser(db, { role: 'lecturer' }))
    await expect(createClassroom(other, courseId)).rejects.toMatchObject({ code: 'FORBIDDEN' })
    const student = ctxFor(db, await makeUser(db, { role: 'student' }))
    await expect(createClassroom(student, courseId)).rejects.toMatchObject({ code: 'FORBIDDEN' })
    expect(accessMock).not.toHaveBeenCalled()
    expect(maker).not.toHaveBeenCalled()
  })

  it('refuses when the classroom switch is off, before touching Google', async () => {
    const { owner, courseId } = await setup()
    vi.stubEnv('MEET_CLASSROOM', 'off')
    await expect(createClassroom(owner, courseId)).rejects.toMatchObject({ code: 'FORBIDDEN' })
    expect(accessMock).not.toHaveBeenCalled()
    expect(await rows(courseId)).toHaveLength(0)
  })

  it('refuses a non-admin lecturer when the switch is admins only', async () => {
    const { owner, courseId } = await setup()
    vi.stubEnv('MEET_CLASSROOM', 'admins')
    vi.stubEnv('ADMIN_EMAILS', 'someone-else@example.com')
    await expect(createClassroom(owner, courseId)).rejects.toMatchObject({ code: 'FORBIDDEN' })
    expect(accessMock).not.toHaveBeenCalled()
  })

  it('allows an admin lecturer when the switch is admins only', async () => {
    const { owner, courseId } = await setup()
    vi.stubEnv('MEET_CLASSROOM', 'admins')
    vi.stubEnv('ADMIN_EMAILS', owner.user.email)
    expect((await createClassroom(owner, courseId)).kind).toBe('ready')
  })

  describe('assertClassroomUsable', () => {
    it('throws no_classroom when the course has none', async () => {
      const { owner, courseId } = await setup()
      await expect(assertClassroomUsable(owner, courseId)).rejects.toMatchObject({
        code: 'VALIDATION',
        details: { fields: ['autoMeet'], reason: 'no_classroom' },
      })
    })

    it('passes once the classroom exists', async () => {
      const { owner, courseId } = await setup()
      await createClassroom(owner, courseId)
      await expect(assertClassroomUsable(owner, courseId)).resolves.toBeUndefined()
    })

    it('is forbidden when the switch does not allow the user', async () => {
      const { owner, courseId } = await setup()
      await createClassroom(owner, courseId)
      vi.stubEnv('MEET_CLASSROOM', 'off')
      await expect(assertClassroomUsable(owner, courseId)).rejects.toMatchObject({ code: 'FORBIDDEN' })
    })
  })
})
