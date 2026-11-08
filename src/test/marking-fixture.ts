import { eq } from 'drizzle-orm'
import { setNowForTests } from '@/server/core/clock'
import type { Ctx } from '@/server/core/context'
import type { Db } from '@/server/db'
import {
  class_,
  classLecturer,
  classStudent,
  course,
  courseRosterAdjustment,
  courseTest,
  school,
  testAnswer,
  testAttempt,
  testOption,
  testQuestion,
  user,
} from '@/server/db/schema'
import { createClass, joinClassAsLecturer, joinClassAsStudent } from '@/server/classes/service'
import { createCourse } from '@/server/courses/service'
import { createSchool } from '@/server/schools/service'
import { ctxFor, makeUser } from './factories'

const MIN = 60_000
/** The fixture's tests start at T0 and run 30 minutes: answers are final from at(32). */
export const T0 = new Date('2026-11-09T08:00:00Z')
export const at = (minutes: number) => new Date(T0.getTime() + minutes * MIN)
export const setClock = (when: Date) => setNowForTests(() => when)

const newCode = () => crypto.randomUUID().replace(/-/g, '').slice(0, 6).toUpperCase()

export async function clearMarkingData(db: Db): Promise<void> {
  setNowForTests(null)
  await db.delete(courseTest)
  await db.delete(courseRosterAdjustment)
  await db.delete(course)
  await db.delete(classStudent)
  await db.delete(classLecturer)
  await db.delete(class_)
  await db.delete(school)
  await db.delete(user)
}

/**
 * A course with its lecturer, a colleague in the same class, and four rostered students
 * (Alice, Bob, Carol, Dave). Dave never joins in these tests.
 */
export async function setupCourse(db: Db) {
  const lecturer = ctxFor(db, await makeUser(db, { role: 'lecturer', name: 'Dr Owner' }))
  const sch = await createSchool(lecturer, { name: 'University of Buea', town: 'Buea' })
  const cls = await createClass(lecturer, { schoolId: sch.id, name: 'Biology L1', academicYear: '2026/27' })
  const colleague = ctxFor(db, await makeUser(db, { role: 'lecturer', name: 'Dr Colleague' }))
  await joinClassAsLecturer(colleague, cls.lecturerCode!)
  const bio = await createCourse(lecturer, { classId: cls.id, title: 'Cell biology', semester: 1 })
  const student = async (name: string, matricule: string, locale: 'en' | 'fr' = 'en') => {
    const s = ctxFor(db, await makeUser(db, { role: 'student', name, locale }))
    await joinClassAsStudent(s, cls.studentCode!, matricule)
    return s
  }
  const alice = await student('Alice', 'UB1')
  const bob = await student('Bob', 'UB2', 'fr')
  const carol = await student('Carol', 'UB3')
  const dave = await student('Dave', 'UB4')
  return { lecturer, colleague, bio, cls, student, alice, bob, carol, dave }
}

/**
 * A started test (T0, 30 minutes). q1: MCQ at the default mark 2, correct o1. q2 (unless
 * mcqOnly): short answer, mark 4. q3 (unless mcqOnly): short answer at the default mark 2.
 * Total 8 (2 when MCQ-only).
 */
export async function insertStartedTest(db: Db, lecturer: Ctx, courseId: string, opts: { mcqOnly?: boolean } = {}) {
  const [test] = await db
    .insert(courseTest)
    .values({
      courseId,
      code: newCode(),
      title: 'CA 1',
      durationMinutes: 30,
      defaultMark: 2,
      startedAt: T0,
      deadlineAt: at(30),
      createdBy: lecturer.user.id,
    })
    .returning()
  const [q1] = await db
    .insert(testQuestion)
    .values({ testId: test.id, position: 0, kind: 'mcq', prompt: 'Which organelle makes ATP?', mark: null })
    .returning()
  const [o1, o2] = await db
    .insert(testOption)
    .values([
      { questionId: q1.id, position: 0, text: 'Mitochondrion', isCorrect: true },
      { questionId: q1.id, position: 1, text: 'Ribosome', isCorrect: false },
    ])
    .returning()
  if (opts.mcqOnly) return { test, q1, q2: null, q3: null, o1, o2 }
  const [q2, q3] = await db
    .insert(testQuestion)
    .values([
      {
        testId: test.id,
        position: 1,
        kind: 'short',
        prompt: 'What is osmosis?',
        mark: 4,
        guide: 'Water moves across a membrane: 2 for water, 2 for membrane.',
      },
      { testId: test.id, position: 2, kind: 'short', prompt: 'Name a function of DNA.', mark: null, guide: 'Stores genetic information.' },
    ])
    .returning()
  return { test, q1, q2, q3, o1, o2 }
}

export async function joinTest(db: Db, testId: string, student: Ctx, joinedAt = at(1)) {
  const [a] = await db
    .insert(testAttempt)
    .values({
      testId,
      studentId: student.user.id,
      seed: crypto.randomUUID(),
      deviceId: crypto.randomUUID(),
      deviceSeenAt: joinedAt,
      joinedAt,
    })
    .returning()
  return a
}

export async function putAnswer(
  db: Db,
  attemptId: string,
  questionId: string,
  value: { optionId?: string; text?: string; mark?: number; comment?: string },
  receivedAt = at(10),
) {
  await db.insert(testAnswer).values({
    attemptId,
    questionId,
    optionId: value.optionId ?? null,
    text: value.text ?? null,
    mark: value.mark ?? null,
    comment: value.comment ?? null,
    rev: 1,
    receivedAt,
  })
}

export async function answerRow(db: Db, attemptId: string, questionId: string) {
  const rows = await db.select().from(testAnswer).where(eq(testAnswer.attemptId, attemptId))
  return rows.find((r) => r.questionId === questionId)!
}

export async function testRowOf(db: Db, testId: string) {
  const [row] = await db.select().from(courseTest).where(eq(courseTest.id, testId))
  return row
}
