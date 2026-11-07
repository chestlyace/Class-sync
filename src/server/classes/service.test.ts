import { afterEach, beforeAll, describe, expect, it } from 'vitest'
import { config, setConfigForTests } from '@/server/core/config'
import type { Db } from '@/server/db'
import { class_, classLecturer, classStudent, school } from '@/server/db/schema'
import { createTestDb } from '@/test/db'
import { ctxFor, makeUser } from '@/test/factories'
import { createSchool } from '@/server/schools/service'
import { eq } from 'drizzle-orm'
import {
  createClass,
  getClassRoster,
  isClassLecturer,
  joinClassAsLecturer,
  joinClassAsStudent,
  listMyClasses,
  regenerateJoinCode,
  removeStudentFromClass,
} from './service'

describe('classes service', () => {
  let db: Db
  const original = config.requireEmailVerification

  beforeAll(async () => {
    db = await createTestDb()
  })
  afterEach(async () => {
    setConfigForTests({ requireEmailVerification: original })
    await db.delete(classStudent)
    await db.delete(classLecturer)
    await db.delete(class_)
    await db.delete(school)
  })

  async function lecturerCtx(overrides = {}) {
    return ctxFor(db, await makeUser(db, { role: 'lecturer', ...overrides }))
  }
  async function studentCtx(overrides = {}) {
    return ctxFor(db, await makeUser(db, { role: 'student', ...overrides }))
  }

  async function setup() {
    const lecturer = await lecturerCtx()
    const sch = await createSchool(lecturer, { name: 'University of Buea', town: 'Buea' })
    const cls = await createClass(lecturer, { schoolId: sch.id, name: 'Computer Science L3', academicYear: '2026/27' })
    return { lecturer, sch, cls }
  }

  it('createClass returns both codes and makes the creator a class lecturer', async () => {
    const { lecturer, sch, cls } = await setup()
    expect(cls).toEqual({
      id: expect.any(String),
      schoolId: sch.id,
      schoolName: 'University of Buea',
      name: 'Computer Science L3',
      academicYear: '2026/27',
      studentCount: 0,
      studentCode: expect.stringMatching(/^[A-HJ-NP-Z2-9]{6}$/),
      lecturerCode: expect.stringMatching(/^[A-HJ-NP-Z2-9]{6}$/),
    })
    expect(cls.studentCode).not.toBe(cls.lecturerCode)
    expect(await isClassLecturer(db, cls.id, lecturer.user.id)).toBe(true)
  })

  it('createClass trims the name', async () => {
    const lecturer = await lecturerCtx()
    const sch = await createSchool(lecturer, { name: 'UB', town: 'Buea' })
    const cls = await createClass(lecturer, { schoolId: sch.id, name: '  Maths  ', academicYear: '2026/27' })
    expect(cls.name).toBe('Maths')
  })

  it('createClass validates name and academic year', async () => {
    const lecturer = await lecturerCtx()
    const sch = await createSchool(lecturer, { name: 'UB', town: 'Buea' })
    const bad = [
      { name: 'x', academicYear: '2026/27' },
      { name: 'x'.repeat(121), academicYear: '2026/27' },
      { name: 'Maths', academicYear: '2026-27' },
      { name: 'Maths', academicYear: '2026/28' },
      { name: 'Maths', academicYear: '26/27' },
      { name: 'Maths', academicYear: '2026/2027' },
    ]
    for (const input of bad) {
      await expect(createClass(lecturer, { schoolId: sch.id, ...input })).rejects.toMatchObject({
        code: 'VALIDATION',
      })
    }
  })

  it('createClass accepts the century rollover 2099/00', async () => {
    const lecturer = await lecturerCtx()
    const sch = await createSchool(lecturer, { name: 'UB', town: 'Buea' })
    await expect(
      createClass(lecturer, { schoolId: sch.id, name: 'Maths', academicYear: '2099/00' }),
    ).resolves.toMatchObject({ academicYear: '2099/00' })
  })

  it('createClass with an unknown school is NOT_FOUND; a student gets FORBIDDEN', async () => {
    const lecturer = await lecturerCtx()
    await expect(
      createClass(lecturer, { schoolId: 'nope', name: 'Maths', academicYear: '2026/27' }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' })
    const student = await studentCtx()
    await expect(
      createClass(student, { schoolId: 'nope', name: 'Maths', academicYear: '2026/27' }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' })
  })

  it('createClass requires a verified email', async () => {
    setConfigForTests({ requireEmailVerification: true })
    const lecturer = await lecturerCtx({ emailVerified: false })
    await expect(
      createClass(lecturer, { schoolId: 'x', name: 'Maths', academicYear: '2026/27' }),
    ).rejects.toMatchObject({ code: 'EMAIL_UNVERIFIED' })
  })

  it('colleague joins with lecturer code and sees the same roster', async () => {
    const { lecturer, cls } = await setup()
    const student = await studentCtx({ name: 'Alice' })
    await joinClassAsStudent(student, cls.studentCode!, 'ub20s1')
    const colleague = await lecturerCtx()
    expect(await joinClassAsLecturer(colleague, cls.lecturerCode!.toLowerCase())).toEqual({ classId: cls.id })
    const a = await getClassRoster(lecturer, cls.id)
    const b = await getClassRoster(colleague, cls.id)
    expect(b).toEqual(a)
    expect(b).toHaveLength(1)
    const mine = await listMyClasses(colleague)
    expect(mine).toHaveLength(1)
    expect(mine[0]).toMatchObject({ id: cls.id, studentCount: 1, studentCode: cls.studentCode })
  })

  it('joining as lecturer twice is idempotent', async () => {
    const { cls } = await setup()
    const colleague = await lecturerCtx()
    await joinClassAsLecturer(colleague, cls.lecturerCode!)
    await joinClassAsLecturer(colleague, cls.lecturerCode!)
    expect(await db.select().from(classLecturer).where(eq(classLecturer.userId, colleague.user.id))).toHaveLength(1)
  })

  it('student joins with student code and matricule; appears in roster with normalised matricule', async () => {
    const { lecturer, cls } = await setup()
    const student = await studentCtx({ name: 'Alice', email: 'alice@example.com' })
    expect(await joinClassAsStudent(student, ` ${cls.studentCode!.slice(0, 3)}-${cls.studentCode!.slice(3)} `, '  ub20  s1 ')).toEqual({
      classId: cls.id,
    })
    expect(await getClassRoster(lecturer, cls.id)).toEqual([
      { studentId: student.user.id, name: 'Alice', email: 'alice@example.com', matricule: 'UB20 S1' },
    ])
  })

  it('an invalid matricule is VALIDATION', async () => {
    const { cls } = await setup()
    const student = await studentCtx()
    await expect(joinClassAsStudent(student, cls.studentCode!, ' a ')).rejects.toMatchObject({
      code: 'VALIDATION',
    })
  })

  it('a wrong-role caller gets FORBIDDEN (student on lecturer join, lecturer on student join)', async () => {
    const { lecturer, cls } = await setup()
    const student = await studentCtx()
    await expect(joinClassAsLecturer(student, cls.lecturerCode!)).rejects.toMatchObject({ code: 'FORBIDDEN' })
    await expect(joinClassAsStudent(lecturer, cls.studentCode!, 'UB1')).rejects.toMatchObject({
      code: 'FORBIDDEN',
    })
    // wrong role gets FORBIDDEN even for a code that does not exist
    await expect(joinClassAsLecturer(student, 'ZZZZZZ')).rejects.toMatchObject({ code: 'FORBIDDEN' })
  })

  it('a code of the other kind does not match (student code on lecturer join and vice versa)', async () => {
    const { cls } = await setup()
    const colleague = await lecturerCtx()
    await expect(joinClassAsLecturer(colleague, cls.studentCode!)).rejects.toMatchObject({ code: 'NOT_FOUND' })
    const student = await studentCtx()
    await expect(joinClassAsStudent(student, cls.lecturerCode!, 'UB1')).rejects.toMatchObject({
      code: 'NOT_FOUND',
    })
  })

  it('unknown or malformed code is NOT_FOUND', async () => {
    await setup()
    const colleague = await lecturerCtx()
    const student = await studentCtx()
    await expect(joinClassAsLecturer(colleague, 'ZZZZZZ')).rejects.toMatchObject({ code: 'NOT_FOUND' })
    await expect(joinClassAsLecturer(colleague, 'abc')).rejects.toMatchObject({ code: 'NOT_FOUND' })
    await expect(joinClassAsLecturer(colleague, '')).rejects.toMatchObject({ code: 'NOT_FOUND' })
    await expect(joinClassAsStudent(student, 'ZZZZZZ', 'UB1')).rejects.toMatchObject({ code: 'NOT_FOUND' })
    await expect(joinClassAsStudent(student, 'I0O1!!', 'UB1')).rejects.toMatchObject({ code: 'NOT_FOUND' })
  })

  it('joining twice keeps one membership', async () => {
    const { lecturer, cls } = await setup()
    const student = await studentCtx()
    await joinClassAsStudent(student, cls.studentCode!, 'UB1')
    await joinClassAsStudent(student, cls.studentCode!, 'UB1')
    expect(await getClassRoster(lecturer, cls.id)).toHaveLength(1)
  })

  it('removed student rejoining is reactivated, not duplicated', async () => {
    const { lecturer, cls } = await setup()
    const student = await studentCtx()
    await joinClassAsStudent(student, cls.studentCode!, 'UB1')
    await removeStudentFromClass(lecturer, cls.id, student.user.id)
    expect(await getClassRoster(lecturer, cls.id)).toHaveLength(0)
    expect((await listMyClasses(student))).toHaveLength(0)
    await joinClassAsStudent(student, cls.studentCode!, 'ub2')
    const roster = await getClassRoster(lecturer, cls.id)
    expect(roster).toHaveLength(1)
    expect(roster[0].matricule).toBe('UB2')
    expect(await db.select().from(classStudent).where(eq(classStudent.userId, student.user.id))).toHaveLength(1)
  })

  it('matricule already used by another student in the class is CONFLICT', async () => {
    const { cls } = await setup()
    const a = await studentCtx()
    const b = await studentCtx()
    await joinClassAsStudent(a, cls.studentCode!, 'UB1')
    await expect(joinClassAsStudent(b, cls.studentCode!, ' ub1 ')).rejects.toMatchObject({ code: 'CONFLICT' })
    // the same matricule is fine in a different class
    const lecturer2 = await lecturerCtx()
    const sch = await createSchool(lecturer2, { name: 'Other', town: 'Douala' })
    const cls2 = await createClass(lecturer2, { schoolId: sch.id, name: 'Physics', academicYear: '2026/27' })
    await expect(joinClassAsStudent(b, cls2.studentCode!, 'UB1')).resolves.toEqual({ classId: cls2.id })
  })

  it('a removed student keeps holding their matricule (rejoin by another student conflicts)', async () => {
    const { lecturer, cls } = await setup()
    const a = await studentCtx()
    const b = await studentCtx()
    await joinClassAsStudent(a, cls.studentCode!, 'UB1')
    await removeStudentFromClass(lecturer, cls.id, a.user.id)
    await expect(joinClassAsStudent(b, cls.studentCode!, 'UB1')).rejects.toMatchObject({ code: 'CONFLICT' })
  })

  it('rejoin with a matricule held by another student is CONFLICT and leaves the row removed', async () => {
    const { lecturer, cls } = await setup()
    const a = await studentCtx()
    const b = await studentCtx()
    await joinClassAsStudent(a, cls.studentCode!, 'UB1')
    await joinClassAsStudent(b, cls.studentCode!, 'UB2')
    await removeStudentFromClass(lecturer, cls.id, a.user.id)
    await expect(joinClassAsStudent(a, cls.studentCode!, 'UB2')).rejects.toMatchObject({ code: 'CONFLICT' })
    expect(await getClassRoster(lecturer, cls.id)).toHaveLength(1)
  })

  it('student cannot read the class roster', async () => {
    const { cls } = await setup()
    const student = await studentCtx()
    await joinClassAsStudent(student, cls.studentCode!, 'UB1')
    await expect(getClassRoster(student, cls.id)).rejects.toMatchObject({ code: 'FORBIDDEN' })
  })

  it('lecturer not teaching the class cannot read roster, regenerate codes or remove students', async () => {
    const { cls } = await setup()
    const outsider = await lecturerCtx()
    await expect(getClassRoster(outsider, cls.id)).rejects.toMatchObject({ code: 'FORBIDDEN' })
    await expect(regenerateJoinCode(outsider, cls.id, 'student')).rejects.toMatchObject({ code: 'FORBIDDEN' })
    await expect(removeStudentFromClass(outsider, cls.id, 'x')).rejects.toMatchObject({ code: 'FORBIDDEN' })
  })

  it('regenerated student code invalidates the old one', async () => {
    const { lecturer, cls } = await setup()
    const fresh = await regenerateJoinCode(lecturer, cls.id, 'student')
    expect(fresh).toMatch(/^[A-HJ-NP-Z2-9]{6}$/)
    expect(fresh).not.toBe(cls.studentCode)
    const student = await studentCtx()
    await expect(joinClassAsStudent(student, cls.studentCode!, 'UB1')).rejects.toMatchObject({ code: 'NOT_FOUND' })
    await expect(joinClassAsStudent(student, fresh, 'UB1')).resolves.toEqual({ classId: cls.id })
    // the lecturer code is untouched
    const [mine] = await listMyClasses(lecturer)
    expect(mine.lecturerCode).toBe(cls.lecturerCode)
    expect(mine.studentCode).toBe(fresh)
  })

  it('regenerated lecturer code invalidates the old one', async () => {
    const { lecturer, cls } = await setup()
    const fresh = await regenerateJoinCode(lecturer, cls.id, 'lecturer')
    const colleague = await lecturerCtx()
    await expect(joinClassAsLecturer(colleague, cls.lecturerCode!)).rejects.toMatchObject({ code: 'NOT_FOUND' })
    await expect(joinClassAsLecturer(colleague, fresh)).resolves.toEqual({ classId: cls.id })
  })

  it('removeStudentFromClass: unknown student is NOT_FOUND, repeat is idempotent', async () => {
    const { lecturer, cls } = await setup()
    const student = await studentCtx()
    await expect(removeStudentFromClass(lecturer, cls.id, student.user.id)).rejects.toMatchObject({
      code: 'NOT_FOUND',
    })
    await joinClassAsStudent(student, cls.studentCode!, 'UB1')
    await removeStudentFromClass(lecturer, cls.id, student.user.id)
    await expect(removeStudentFromClass(lecturer, cls.id, student.user.id)).resolves.toBeUndefined()
  })

  it('ClassSummary hides codes from students', async () => {
    const { lecturer, cls } = await setup()
    const student = await studentCtx()
    await joinClassAsStudent(student, cls.studentCode!, 'UB1')
    const [forStudent] = await listMyClasses(student)
    expect(forStudent).toEqual({
      id: cls.id,
      schoolId: cls.schoolId,
      schoolName: 'University of Buea',
      name: 'Computer Science L3',
      academicYear: '2026/27',
      studentCount: 1,
    })
    expect('studentCode' in forStudent).toBe(false)
    expect('lecturerCode' in forStudent).toBe(false)
    const [forLecturer] = await listMyClasses(lecturer)
    expect(forLecturer.studentCode).toBe(cls.studentCode)
    expect(forLecturer.lecturerCode).toBe(cls.lecturerCode)
  })

  it('listMyClasses orders by school name then class name and counts active students only', async () => {
    const lecturer = await lecturerCtx()
    const sB = await createSchool(lecturer, { name: 'B School', town: 'Town' })
    const sA = await createSchool(lecturer, { name: 'A School', town: 'Town' })
    const b1 = await createClass(lecturer, { schoolId: sB.id, name: 'Alpha', academicYear: '2026/27' })
    await createClass(lecturer, { schoolId: sA.id, name: 'Zulu', academicYear: '2026/27' })
    await createClass(lecturer, { schoolId: sA.id, name: 'Mike', academicYear: '2026/27' })
    const s1 = await studentCtx()
    const s2 = await studentCtx()
    await joinClassAsStudent(s1, b1.studentCode!, 'UB1')
    await joinClassAsStudent(s2, b1.studentCode!, 'UB2')
    await removeStudentFromClass(lecturer, b1.id, s2.user.id)
    const list = await listMyClasses(lecturer)
    expect(list.map((c) => `${c.schoolName}/${c.name}`)).toEqual(['A School/Mike', 'A School/Zulu', 'B School/Alpha'])
    expect(list.map((c) => c.studentCount)).toEqual([0, 0, 1])
  })

  it('listMyClasses only shows classes the caller teaches', async () => {
    await setup()
    const outsider = await lecturerCtx()
    expect(await listMyClasses(outsider)).toEqual([])
  })

  it('getClassRoster orders by name (case-insensitive) then matricule', async () => {
    const { lecturer, cls } = await setup()
    const names = ['bob', 'Alice', 'alice', 'Carl']
    const mats = ['UB4', 'UB3', 'UB2', 'UB1']
    for (let i = 0; i < names.length; i++) {
      await joinClassAsStudent(await studentCtx({ name: names[i] }), cls.studentCode!, mats[i])
    }
    const roster = await getClassRoster(lecturer, cls.id)
    expect(roster.map((r) => `${r.name}:${r.matricule}`)).toEqual(['alice:UB2', 'Alice:UB3', 'bob:UB4', 'Carl:UB1'])
  })

  it('isClassLecturer is false for non-members and unknown classes', async () => {
    const { cls } = await setup()
    const other = await lecturerCtx()
    expect(await isClassLecturer(db, cls.id, other.user.id)).toBe(false)
    expect(await isClassLecturer(db, 'nope', other.user.id)).toBe(false)
  })
})
