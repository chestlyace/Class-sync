import { eq, inArray } from 'drizzle-orm'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Ctx } from '@/server/core/context'
import type { Db } from '@/server/db'
import {
  assignment,
  assignmentAttachment,
  attendanceCheckIn,
  attendanceSession,
  attendanceWindow,
  class_,
  classExtra,
  classLecturer,
  classSlot,
  classStudent,
  course,
  courseClassroom,
  courseTest,
  courseTopic,
  file,
  onlineClassJoin,
  participationEvent,
  resource,
  resourcePlacement,
  revisionGroup,
  revisionQuestion,
  school,
  submission,
  submissionFile,
  testAnswer,
  testAttempt,
  testOption,
  testQuestion,
} from '@/server/db/schema'
import { createTestDb } from '@/test/db'
import { ctxFor, makeUser } from '@/test/factories'
import { createSchool } from '@/server/schools/service'
import { createClass, joinClassAsLecturer, joinClassAsStudent } from '@/server/classes/service'
import { createCourse, getCourse, listStudentCourses } from './service'
import { deleteCourse, getCourseDeletionImpact } from './delete'

const removed = vi.hoisted(() => [] as string[])
vi.mock('@/server/files/storage', () => ({
  getStorage: () => ({
    remove: async (key: string) => {
      removed.push(key)
    },
  }),
}))
vi.mock('@/server/push/send', () => ({
  sendPush: vi.fn(async () => ({ sent: 0, skipped: 0, failed: 0, removed: 0 })),
  queuePush: vi.fn(async () => {}),
}))

describe('deleteCourse', () => {
  let db: Db

  beforeAll(async () => {
    db = await createTestDb()
  })
  beforeEach(() => {
    removed.length = 0
  })
  afterEach(async () => {
    await db.delete(onlineClassJoin)
    await db.delete(revisionGroup)
    await db.delete(resource)
    await db.delete(file)
    await db.delete(course)
    await db.delete(classStudent)
    await db.delete(classLecturer)
    await db.delete(class_)
    await db.delete(school)
  })

  async function lecturerCtx() {
    return ctxFor(db, await makeUser(db, { role: 'lecturer' }))
  }

  /** A class shared by two lecturers, one student, two courses of mine and one of my colleague's. */
  async function setup() {
    const lecturer = await lecturerCtx()
    const sch = await createSchool(lecturer, { name: 'University of Buea', town: 'Buea' })
    const cls = await createClass(lecturer, { schoolId: sch.id, name: 'CS L3', academicYear: '2026/27' })
    const colleague = await lecturerCtx()
    await joinClassAsLecturer(colleague, cls.lecturerCode!)
    const student = ctxFor(db, await makeUser(db, { role: 'student' }))
    await joinClassAsStudent(student, cls.studentCode!, 'UB26-001')
    const algo = await createCourse(lecturer, { classId: cls.id, title: 'Algorithms', semester: 1 })
    const dbs = await createCourse(lecturer, { classId: cls.id, title: 'Databases', semester: 1 })
    const theirs = await createCourse(colleague, { classId: cls.id, title: 'Networks', semester: 1 })
    return { lecturer, colleague, student, cls, algo, dbs, theirs }
  }

  async function addFile(owner: Ctx, purpose: 'assignment' | 'submission' | 'resource') {
    const id = crypto.randomUUID()
    const storageKey = `${purpose}s/${id}-doc.pdf`
    await db.insert(file).values({
      id,
      ownerId: owner.user.id,
      purpose,
      storageKey,
      name: 'doc.pdf',
      mimeType: 'application/pdf',
      sizeBytes: 100,
      confirmedAt: new Date(),
    })
    return { id, storageKey }
  }

  async function addTopic(courseId: string) {
    const [topic] = await db.insert(courseTopic).values({ courseId, title: 'Week 1', position: 0 }).returning()
    return topic.id
  }

  /** Every kind of record a course can hold, including the RESTRICT links to its topics. */
  async function populate(lecturer: Ctx, student: Ctx, courseId: string) {
    const topicId = await addTopic(courseId)
    const [note] = await db.insert(resource).values({ ownerId: lecturer.user.id, kind: 'note', title: 'Intro' }).returning()
    const resourceFile = await addFile(lecturer, 'resource')
    const [fileRes] = await db
      .insert(resource)
      .values({ ownerId: lecturer.user.id, kind: 'file', title: 'Slides', fileId: resourceFile.id })
      .returning()
    await db.insert(resourcePlacement).values([
      { resourceId: note.id, courseId, topicId, position: 0 },
      { resourceId: fileRes.id, courseId, topicId, position: 1 },
    ])
    const [group] = await db.insert(revisionGroup).values({ courseId, topicId, position: 0 }).returning()
    await db.insert(revisionQuestion).values({ groupId: group.id, position: 0, kind: 'short', prompt: 'Why?' })
    await db.insert(participationEvent).values({ courseId, studentId: student.user.id, delta: 1, createdBy: lecturer.user.id })

    const [test] = await db
      .insert(courseTest)
      .values({ courseId, code: `T${crypto.randomUUID().slice(0, 6)}`, title: 'Quiz', durationMinutes: 20, defaultMark: 1, createdBy: lecturer.user.id })
      .returning()
    const [question] = await db.insert(testQuestion).values({ testId: test.id, position: 0, kind: 'mcq', prompt: '2+2?' }).returning()
    const [option] = await db.insert(testOption).values({ questionId: question.id, position: 0, text: '4', isCorrect: true }).returning()
    const [attempt] = await db
      .insert(testAttempt)
      .values({ testId: test.id, studentId: student.user.id, seed: 's', deviceId: 'd', deviceSeenAt: new Date() })
      .returning()
    await db.insert(testAnswer).values({ attemptId: attempt.id, questionId: question.id, optionId: option.id, rev: 1, receivedAt: new Date() })

    const [work] = await db
      .insert(assignment)
      .values({ courseId, title: 'Essay', dueAt: new Date(), maxMark: 20, submissionMode: 'files', createdBy: lecturer.user.id })
      .returning()
    const brief = await addFile(lecturer, 'assignment')
    await db.insert(assignmentAttachment).values({ assignmentId: work.id, fileId: brief.id, position: 0 })
    const [sub] = await db
      .insert(submission)
      .values({ assignmentId: work.id, studentId: student.user.id, submittedAt: new Date(), mark: 15 })
      .returning()
    const answerFile = await addFile(student, 'submission')
    await db.insert(submissionFile).values({ submissionId: sub.id, fileId: answerFile.id, position: 0 })

    const [session] = await db.insert(attendanceSession).values({ courseId, createdBy: lecturer.user.id }).returning()
    const [window] = await db
      .insert(attendanceWindow)
      .values({ sessionId: session.id, kind: 'start', secret: 'x', openedBy: lecturer.user.id })
      .returning()
    await db.insert(attendanceCheckIn).values({ windowId: window.id, studentId: student.user.id })

    const [slot] = await db
      .insert(classSlot)
      .values({
        courseId,
        weekday: 1,
        startMinute: 480,
        endMinute: 600,
        startsOn: '2026-09-01',
        endsOn: '2027-06-30',
        createdBy: lecturer.user.id,
      })
      .returning()
    const [extra] = await db
      .insert(classExtra)
      .values({
        courseId,
        startsAt: new Date('2026-11-18T08:00:00Z'),
        endsAt: new Date('2026-11-18T10:00:00Z'),
        meetingUrl: 'https://meet.google.com/abc-defg-hij',
        createdBy: lecturer.user.id,
      })
      .returning()
    await db.insert(courseClassroom).values({
      courseId,
      spaceName: 'spaces/abc123',
      meetingUrl: 'https://meet.google.com/abc-defg-hij',
      meetingCode: 'abc-defg-hij',
      googleAccountId: 'google-account-1',
      knockingConfirmed: true,
      createdBy: lecturer.user.id,
    })
    await db.insert(onlineClassJoin).values([
      {
        occurrenceKey: `slot:${slot.id}:2026-11-16`,
        studentId: student.user.id,
        firstJoinedAt: new Date(),
        lastJoinedAt: new Date(),
      },
      {
        occurrenceKey: `extra:${extra.id}`,
        studentId: student.user.id,
        firstJoinedAt: new Date(),
        lastJoinedAt: new Date(),
      },
    ])

    return { files: [resourceFile, brief, answerFile], resourceIds: [note.id, fileRes.id] }
  }

  it('deletes a course full of records, including its notes topics and practice groups', async () => {
    const { lecturer, student, algo, dbs } = await setup()
    const seeded = await populate(lecturer, student, algo.id)

    await deleteCourse(lecturer, algo.id, '  algorithms ')

    expect(await db.select().from(course).where(eq(course.id, algo.id))).toEqual([])
    expect(await db.select().from(onlineClassJoin)).toEqual([])
    expect(await db.select().from(courseClassroom)).toEqual([])
    for (const table of [courseTopic, revisionGroup, courseTest, assignment, attendanceSession, classSlot]) {
      expect(await db.select().from(table).where(eq(table.courseId, algo.id))).toEqual([])
    }
    expect(await db.select().from(resource).where(inArray(resource.id, seeded.resourceIds))).toEqual([])
    const fileIds = seeded.files.map((f) => f.id)
    expect(await db.select().from(file).where(inArray(file.id, fileIds))).toEqual([])
    expect(removed.sort()).toEqual(seeded.files.map((f) => f.storageKey).sort())
    expect(await getCourse(lecturer, dbs.id)).toMatchObject({ id: dbs.id })
  })

  it('keeps a note that is also placed in another of my courses', async () => {
    const { lecturer, algo, dbs } = await setup()
    const shared = await addFile(lecturer, 'resource')
    const [res] = await db
      .insert(resource)
      .values({ ownerId: lecturer.user.id, kind: 'file', title: 'Shared slides', fileId: shared.id })
      .returning()
    await db.insert(resourcePlacement).values([
      { resourceId: res.id, courseId: algo.id, topicId: await addTopic(algo.id), position: 0 },
      { resourceId: res.id, courseId: dbs.id, topicId: await addTopic(dbs.id), position: 0 },
    ])

    await deleteCourse(lecturer, algo.id, 'Algorithms')

    expect(await db.select().from(resource).where(eq(resource.id, res.id))).toHaveLength(1)
    expect(await db.select().from(file).where(eq(file.id, shared.id))).toHaveLength(1)
    expect(await db.select().from(resourcePlacement).where(eq(resourcePlacement.resourceId, res.id))).toEqual([
      expect.objectContaining({ courseId: dbs.id }),
    ])
    expect(removed).toEqual([])
  })

  it('counts what will be lost, leaving out notes that another course keeps', async () => {
    const { lecturer, student, algo, dbs } = await setup()
    await populate(lecturer, student, algo.id)
    const [shared] = await db.insert(resource).values({ ownerId: lecturer.user.id, kind: 'note', title: 'Shared' }).returning()
    await db.insert(resourcePlacement).values([
      { resourceId: shared.id, courseId: algo.id, topicId: await addTopic(algo.id), position: 0 },
      { resourceId: shared.id, courseId: dbs.id, topicId: await addTopic(dbs.id), position: 0 },
    ])
    expect(await getCourseDeletionImpact(lecturer, algo.id)).toEqual({
      courses: 1,
      students: 1,
      attendanceSessions: 1,
      assignments: 1,
      submissions: 1,
      tests: 1,
      testAttempts: 1,
      participation: 1,
      practiceQuestions: 1,
      timetableSlots: 1,
      notes: 2,
    })
  })

  it('keeps a stored file that an assignment in another course still uses', async () => {
    const { lecturer, algo, dbs } = await setup()
    const brief = await addFile(lecturer, 'assignment')
    for (const courseId of [algo.id, dbs.id]) {
      const [work] = await db
        .insert(assignment)
        .values({ courseId, title: 'Essay', dueAt: new Date(), maxMark: 20, submissionMode: 'files', createdBy: lecturer.user.id })
        .returning()
      await db.insert(assignmentAttachment).values({ assignmentId: work.id, fileId: brief.id, position: 0 })
    }

    await deleteCourse(lecturer, algo.id, 'Algorithms')

    expect(await db.select().from(file).where(eq(file.id, brief.id))).toHaveLength(1)
    expect(removed).toEqual([])
  })

  it('a wrong confirmation is VALIDATION on the confirm field and deletes nothing', async () => {
    const { lecturer, algo } = await setup()
    await expect(deleteCourse(lecturer, algo.id, 'Algorithm')).rejects.toMatchObject({
      code: 'VALIDATION',
      details: { fields: ['confirm'] },
    })
    expect(await getCourse(lecturer, algo.id)).toMatchObject({ id: algo.id })
  })

  it('a colleague sharing the class, an outsider and a student are FORBIDDEN', async () => {
    const { colleague, student, algo } = await setup()
    for (const ctx of [colleague, student, await lecturerCtx()]) {
      await expect(deleteCourse(ctx, algo.id, 'Algorithms')).rejects.toMatchObject({ code: 'FORBIDDEN' })
      await expect(getCourseDeletionImpact(ctx, algo.id)).rejects.toMatchObject({ code: 'FORBIDDEN' })
    }
    expect(await db.select().from(course).where(eq(course.id, algo.id))).toHaveLength(1)
  })

  it('students stop seeing the deleted course; the rest of the class stays', async () => {
    const { lecturer, student, algo } = await setup()
    await deleteCourse(lecturer, algo.id, 'Algorithms')
    const titles = (await listStudentCourses(student)).map((c) => c.title).sort()
    expect(titles).toEqual(['Databases', 'Networks'])
  })
})
