import { afterEach, beforeAll, describe, expect, it } from 'vitest'
import { config, setConfigForTests } from '@/server/core/config'
import type { Ctx } from '@/server/core/context'
import type { Db } from '@/server/db'
import { class_, classLecturer, classStudent, course, courseRosterAdjustment, school } from '@/server/db/schema'
import { createTestDb } from '@/test/db'
import { ctxFor, makeUser } from '@/test/factories'
import { createSchool } from '@/server/schools/service'
import { createClass, joinClassAsLecturer, joinClassAsStudent, removeStudentFromClass } from '@/server/classes/service'
import {
  createCourse,
  getCourse,
  getCourseRoster,
  isOnCourseRoster,
  listLecturerCourses,
  listStudentCourses,
  requireCourseOwner,
  searchSchoolStudentsForCourse,
  setRosterAdjustment,
} from './service'

describe('courses service', () => {
  let db: Db
  const original = config.requireEmailVerification

  beforeAll(async () => {
    db = await createTestDb()
  })
  afterEach(async () => {
    setConfigForTests({ requireEmailVerification: original })
    await db.delete(courseRosterAdjustment)
    await db.delete(course)
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
  async function enroll(student: Ctx, studentCode: string, matricule: string) {
    await joinClassAsStudent(student, studentCode, matricule)
  }

  /** One school, one class, a lecturer who owns two courses in it, and a colleague sharing the class. */
  async function setup() {
    const lecturer = await lecturerCtx({ name: 'Dr Owner' })
    const sch = await createSchool(lecturer, { name: 'University of Buea', town: 'Buea' })
    const cls = await createClass(lecturer, { schoolId: sch.id, name: 'CS L3', academicYear: '2026/27' })
    const colleague = await lecturerCtx({ name: 'Dr Colleague' })
    await joinClassAsLecturer(colleague, cls.lecturerCode!)
    const algo = await createCourse(lecturer, { classId: cls.id, title: 'Algorithms', code: 'cs301', semester: 1 })
    const dbs = await createCourse(lecturer, { classId: cls.id, title: 'Databases', semester: 2 })
    return { lecturer, colleague, sch, cls, algo, dbs }
  }

  it('class lecturer creates a course; non-class lecturer gets FORBIDDEN', async () => {
    const { lecturer, sch, cls } = await setup()
    const course1 = await createCourse(lecturer, { classId: cls.id, title: '  Networks  ', code: ' net101 ', semester: 3 })
    expect(course1).toEqual({
      id: expect.any(String),
      title: 'Networks',
      code: 'NET101',
      semester: 3,
      classId: cls.id,
      className: 'CS L3',
      schoolId: sch.id,
      schoolName: 'University of Buea',
      lecturerName: lecturer.user.name,
    })
    const outsider = await lecturerCtx()
    await expect(
      createCourse(outsider, { classId: cls.id, title: 'Networks', semester: 1 }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' })
    await expect(
      createCourse(lecturer, { classId: 'no-such-class', title: 'Networks', semester: 1 }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' })
    const student = await studentCtx()
    await expect(
      createCourse(student, { classId: cls.id, title: 'Networks', semester: 1 }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' })
  })

  it('createCourse stores the code uppercase, blank code as null, and validates input', async () => {
    const { lecturer, cls } = await setup()
    const blank = await createCourse(lecturer, { classId: cls.id, title: 'Maths', code: '   ', semester: 1 })
    expect(blank.code).toBeNull()
    const bad = [
      { title: 'x', semester: 1 },
      { title: 'x'.repeat(121), semester: 1 },
      { title: 'Maths', code: 'x'.repeat(21), semester: 1 },
      { title: 'Maths', semester: 0 },
      { title: 'Maths', semester: 4 },
      { title: 'Maths', semester: 1.5 },
    ]
    for (const input of bad) {
      await expect(
        createCourse(lecturer, { classId: cls.id, ...input } as Parameters<typeof createCourse>[1]),
      ).rejects.toMatchObject({ code: 'VALIDATION' })
    }
  })

  it('createCourse requires a verified email', async () => {
    setConfigForTests({ requireEmailVerification: true })
    const lecturer = await lecturerCtx({ emailVerified: false })
    await expect(
      createCourse(lecturer, { classId: 'x', title: 'Maths', semester: 1 }),
    ).rejects.toMatchObject({ code: 'EMAIL_UNVERIFIED' })
  })

  it('student who joins the class later is automatically on every course roster', async () => {
    const { lecturer, cls, algo, dbs } = await setup()
    const student = await studentCtx({ name: 'Alice' })
    expect(await isOnCourseRoster(db, algo.id, student.user.id)).toBe(false)
    await enroll(student, cls.studentCode!, 'ub20s1')
    for (const c of [algo, dbs]) {
      expect(await isOnCourseRoster(db, c.id, student.user.id)).toBe(true)
      expect(await getCourseRoster(lecturer, c.id)).toEqual([
        { studentId: student.user.id, name: 'Alice', email: student.user.email, matricule: 'UB20S1', source: 'class' },
      ])
    }
  })

  it('excluded student is off this course roster but still on the sibling course', async () => {
    const { lecturer, cls, algo, dbs } = await setup()
    const student = await studentCtx({ name: 'Alice' })
    await enroll(student, cls.studentCode!, 'UB20S1')
    await setRosterAdjustment(lecturer, algo.id, student.user.id, 'exclude')
    expect(await getCourseRoster(lecturer, algo.id)).toEqual([])
    expect(await isOnCourseRoster(db, algo.id, student.user.id)).toBe(false)
    expect(await getCourseRoster(lecturer, dbs.id)).toHaveLength(1)
    expect((await listStudentCourses(student)).map((c) => c.id)).toEqual([dbs.id])
    // Clearing restores the student, and clearing again is fine.
    await setRosterAdjustment(lecturer, algo.id, student.user.id, null)
    await setRosterAdjustment(lecturer, algo.id, student.user.id, null)
    expect(await isOnCourseRoster(db, algo.id, student.user.id)).toBe(true)
  })

  it('included carry-over student from another class at the same school is on the roster with source "included"', async () => {
    const { lecturer, sch, cls, algo } = await setup()
    const otherClass = await createClass(lecturer, { schoolId: sch.id, name: 'CS L2', academicYear: '2026/27' })
    const regular = await studentCtx({ name: 'Bob' })
    const carry = await studentCtx({ name: 'Alice' })
    await enroll(regular, cls.studentCode!, 'UB20S2')
    await enroll(carry, otherClass.studentCode!, 'ub21s9')

    expect(await isOnCourseRoster(db, algo.id, carry.user.id)).toBe(false)
    await setRosterAdjustment(lecturer, algo.id, carry.user.id, 'include')
    expect(await isOnCourseRoster(db, algo.id, carry.user.id)).toBe(true)
    expect(await getCourseRoster(lecturer, algo.id)).toEqual([
      { studentId: carry.user.id, name: 'Alice', email: carry.user.email, matricule: 'UB21S9', source: 'included' },
      { studentId: regular.user.id, name: 'Bob', email: regular.user.email, matricule: 'UB20S2', source: 'class' },
    ])
    const listed = await listStudentCourses(carry)
    expect(listed.map((c) => c.id)).toEqual([algo.id])
    expect((await getCourse(carry, algo.id)).id).toBe(algo.id)
    // The sibling course was not included.
    await expect(getCourse(carry, (await listLecturerCourses(lecturer)).find((c) => c.id !== algo.id)!.id)).rejects.toMatchObject({
      code: 'FORBIDDEN',
    })
  })

  it('an included student who leaves every class at the school drops off the roster', async () => {
    const { lecturer, sch, algo } = await setup()
    const otherClass = await createClass(lecturer, { schoolId: sch.id, name: 'CS L2', academicYear: '2026/27' })
    const carry = await studentCtx({ name: 'Alice' })
    await enroll(carry, otherClass.studentCode!, 'UB21S9')
    await setRosterAdjustment(lecturer, algo.id, carry.user.id, 'include')
    await removeStudentFromClass(lecturer, otherClass.id, carry.user.id)
    expect(await isOnCourseRoster(db, algo.id, carry.user.id)).toBe(false)
    expect(await getCourseRoster(lecturer, algo.id)).toEqual([])
  })

  it('an included student uses the most recent school membership for the matricule', async () => {
    const { lecturer, sch, algo } = await setup()
    const older = await createClass(lecturer, { schoolId: sch.id, name: 'CS L1', academicYear: '2025/26' })
    const newer = await createClass(lecturer, { schoolId: sch.id, name: 'CS L2', academicYear: '2026/27' })
    const carry = await studentCtx({ name: 'Alice' })
    await enroll(carry, older.studentCode!, 'OLD1')
    await enroll(carry, newer.studentCode!, 'NEW1')
    await setRosterAdjustment(lecturer, algo.id, carry.user.id, 'include')
    expect((await getCourseRoster(lecturer, algo.id))[0]).toMatchObject({ matricule: 'NEW1', source: 'included' })
  })

  it('including a student from a different school is VALIDATION', async () => {
    const { lecturer, algo } = await setup()
    const otherSchool = await createSchool(lecturer, { name: 'Other University', town: 'Douala' })
    const otherClass = await createClass(lecturer, { schoolId: otherSchool.id, name: 'Law L1', academicYear: '2026/27' })
    const stranger = await studentCtx()
    await enroll(stranger, otherClass.studentCode!, 'OU1')
    await expect(setRosterAdjustment(lecturer, algo.id, stranger.user.id, 'include')).rejects.toMatchObject({
      code: 'VALIDATION',
    })
    const homeless = await studentCtx()
    await expect(setRosterAdjustment(lecturer, algo.id, homeless.user.id, 'include')).rejects.toMatchObject({
      code: 'VALIDATION',
    })
    expect(await isOnCourseRoster(db, algo.id, stranger.user.id)).toBe(false)
  })

  it('rejects adjustments that make no sense (non-student, include own class, exclude outsider)', async () => {
    const { lecturer, colleague, sch, cls, algo } = await setup()
    const otherClass = await createClass(lecturer, { schoolId: sch.id, name: 'CS L2', academicYear: '2026/27' })
    const inClass = await studentCtx()
    await enroll(inClass, cls.studentCode!, 'UB1')
    const elsewhere = await studentCtx()
    await enroll(elsewhere, otherClass.studentCode!, 'UB2')

    await expect(setRosterAdjustment(lecturer, algo.id, colleague.user.id, 'include')).rejects.toMatchObject({ code: 'VALIDATION' })
    await expect(setRosterAdjustment(lecturer, algo.id, 'no-such-user', 'exclude')).rejects.toMatchObject({ code: 'VALIDATION' })
    await expect(setRosterAdjustment(lecturer, algo.id, inClass.user.id, 'include')).rejects.toMatchObject({ code: 'VALIDATION' })
    await expect(setRosterAdjustment(lecturer, algo.id, elsewhere.user.id, 'exclude')).rejects.toMatchObject({ code: 'VALIDATION' })
  })

  it('removed-from-class student is off the roster', async () => {
    const { lecturer, cls, algo } = await setup()
    const student = await studentCtx({ name: 'Alice' })
    await enroll(student, cls.studentCode!, 'UB20S1')
    expect(await isOnCourseRoster(db, algo.id, student.user.id)).toBe(true)
    await removeStudentFromClass(lecturer, cls.id, student.user.id)
    expect(await isOnCourseRoster(db, algo.id, student.user.id)).toBe(false)
    expect(await getCourseRoster(lecturer, algo.id)).toEqual([])
    expect(await listStudentCourses(student)).toEqual([])
  })

  it('an exclusion persists when the student leaves the class and rejoins', async () => {
    const { lecturer, cls, algo } = await setup()
    const student = await studentCtx()
    await enroll(student, cls.studentCode!, 'UB20S1')
    await setRosterAdjustment(lecturer, algo.id, student.user.id, 'exclude')
    await removeStudentFromClass(lecturer, cls.id, student.user.id)
    await enroll(student, cls.studentCode!, 'UB20S1')
    // The exclusion is per course and persists across a rejoin.
    expect(await isOnCourseRoster(db, algo.id, student.user.id)).toBe(false)
  })

  it('colleague sharing the class cannot read or adjust my course roster', async () => {
    const { lecturer, colleague, cls, algo } = await setup()
    const student = await studentCtx()
    await enroll(student, cls.studentCode!, 'UB20S1')
    await expect(getCourseRoster(colleague, algo.id)).rejects.toMatchObject({ code: 'FORBIDDEN' })
    await expect(setRosterAdjustment(colleague, algo.id, student.user.id, 'exclude')).rejects.toMatchObject({ code: 'FORBIDDEN' })
    await expect(getCourse(colleague, algo.id)).rejects.toMatchObject({ code: 'FORBIDDEN' })
    await expect(requireCourseOwner(colleague, algo.id)).rejects.toMatchObject({ code: 'FORBIDDEN' })
    expect(await listLecturerCourses(colleague)).toEqual([])
    // Nothing changed.
    expect(await getCourseRoster(lecturer, algo.id)).toHaveLength(1)
  })

  it('requireCourseOwner returns the course for the owner; unknown id and students are FORBIDDEN', async () => {
    const { lecturer, algo } = await setup()
    await expect(requireCourseOwner(lecturer, algo.id)).resolves.toEqual(algo)
    await expect(requireCourseOwner(lecturer, 'nope')).rejects.toMatchObject({ code: 'FORBIDDEN' })
    await expect(getCourse(lecturer, 'nope')).rejects.toMatchObject({ code: 'FORBIDDEN' })
    const student = await studentCtx()
    await expect(requireCourseOwner(student, algo.id)).rejects.toMatchObject({ code: 'FORBIDDEN' })
    await expect(getCourseRoster(student, algo.id)).rejects.toMatchObject({ code: 'FORBIDDEN' })
  })

  it('listStudentCourses shows courses from two lecturers in the same class', async () => {
    const { colleague, cls, algo, dbs } = await setup()
    const theirs = await createCourse(colleague, { classId: cls.id, title: 'Compilers', semester: 2 })
    const student = await studentCtx()
    await enroll(student, cls.studentCode!, 'UB20S1')
    const listed = await listStudentCourses(student)
    expect(listed.map((c) => c.title)).toEqual(['Algorithms', 'Compilers', 'Databases'])
    expect(new Set(listed.map((c) => c.id))).toEqual(new Set([algo.id, dbs.id, theirs.id]))
    expect(listed.find((c) => c.id === theirs.id)?.lecturerName).toBe('Dr Colleague')
    await expect(listStudentCourses(colleague)).rejects.toMatchObject({ code: 'FORBIDDEN' })
  })

  it('listLecturerCourses lists only my courses, ordered by school, class, title', async () => {
    const { lecturer, colleague, cls, sch } = await setup()
    await createCourse(colleague, { classId: cls.id, title: 'Compilers', semester: 2 })
    const zClass = await createClass(lecturer, { schoolId: sch.id, name: 'AI L1', academicYear: '2026/27' })
    await createCourse(lecturer, { classId: zClass.id, title: 'Zoology of Agents', semester: 1 })
    const listed = await listLecturerCourses(lecturer)
    expect(listed.map((c) => `${c.className}/${c.title}`)).toEqual([
      'AI L1/Zoology of Agents',
      'CS L3/Algorithms',
      'CS L3/Databases',
    ])
    await expect(listLecturerCourses(await studentCtx())).rejects.toMatchObject({ code: 'FORBIDDEN' })
  })

  it('student not on roster cannot getCourse', async () => {
    const { algo, cls } = await setup()
    const outsider = await studentCtx()
    await expect(getCourse(outsider, algo.id)).rejects.toMatchObject({ code: 'FORBIDDEN' })
    const member = await studentCtx()
    await enroll(member, cls.studentCode!, 'UB20S1')
    await expect(getCourse(member, algo.id)).resolves.toMatchObject({ id: algo.id, title: 'Algorithms', code: 'CS301' })
  })

  it('roster is ordered by lower(name) then matricule', async () => {
    const { lecturer, cls, algo } = await setup()
    for (const [name, mat] of [['bob', 'UB3'], ['Alice', 'UB2'], ['alice', 'UB1']] as const) {
      await enroll(await studentCtx({ name }), cls.studentCode!, mat)
    }
    const roster = await getCourseRoster(lecturer, algo.id)
    expect(roster.map((r) => r.matricule)).toEqual(['UB1', 'UB2', 'UB3'])
  })
  describe('searchSchoolStudentsForCourse', () => {
    /**
     * setup() plus one active student in the course's own class (search is closed while that class
     * is empty), a colleague's own class at the same school, and a class at another school.
     */
    async function searchSetup() {
      const base = await setup()
      await enroll(await studentCtx({ name: 'Anchor Member' }), base.cls.studentCode!, 'ANC1')
      const colleagueClass = await createClass(base.colleague, {
        schoolId: base.sch.id,
        name: 'Maths L3',
        academicYear: '2026/27',
      })
      const otherSchool = await createSchool(base.colleague, { name: 'Other University', town: 'Douala' })
      const otherSchoolClass = await createClass(base.colleague, {
        schoolId: otherSchool.id,
        name: 'Law L1',
        academicYear: '2026/27',
      })
      return { ...base, colleagueClass, otherSchoolClass }
    }

    it("finds a student of a colleague's class at the same school, by name or matricule, without email", async () => {
      const { lecturer, algo, colleagueClass } = await searchSetup()
      const zoe = await studentCtx({ name: 'Zoé Nkemelu' })
      await enroll(zoe, colleagueClass.studentCode!, 'ma21x07')
      const expected = [{ studentId: zoe.user.id, name: 'Zoé Nkemelu', matricule: 'MA21X07' }]
      expect(await searchSchoolStudentsForCourse(lecturer, algo.id, '  nkem ')).toEqual(expected)
      expect(await searchSchoolStudentsForCourse(lecturer, algo.id, 'a21x')).toEqual(expected)
      const [found] = await searchSchoolStudentsForCourse(lecturer, algo.id, 'zoé')
      expect(Object.keys(found).sort()).toEqual(['matricule', 'name', 'studentId'])
    })

    it('ignores students of another school and students removed from their class', async () => {
      const { lecturer, colleague, algo, colleagueClass, otherSchoolClass } = await searchSetup()
      const elsewhere = await studentCtx({ name: 'Zoe Elsewhere' })
      await enroll(elsewhere, otherSchoolClass.studentCode!, 'OU1')
      const removed = await studentCtx({ name: 'Zoe Removed' })
      await enroll(removed, colleagueClass.studentCode!, 'RM1')
      await removeStudentFromClass(colleague, colleagueClass.id, removed.user.id)
      expect(await searchSchoolStudentsForCourse(lecturer, algo.id, 'zoe')).toEqual([])
    })

    it('leaves out students already on the roster and members of the course class', async () => {
      const { lecturer, algo, cls, colleagueClass } = await searchSetup()
      const member = await studentCtx({ name: 'Zoe Member' })
      await enroll(member, cls.studentCode!, 'IN1')
      const excludedMember = await studentCtx({ name: 'Zoe Excluded' })
      await enroll(excludedMember, cls.studentCode!, 'IN2')
      await setRosterAdjustment(lecturer, algo.id, excludedMember.user.id, 'exclude')
      const included = await studentCtx({ name: 'Zoe Included' })
      await enroll(included, colleagueClass.studentCode!, 'MA1')
      await setRosterAdjustment(lecturer, algo.id, included.user.id, 'include')
      const candidate = await studentCtx({ name: 'Zoe Candidate' })
      await enroll(candidate, colleagueClass.studentCode!, 'MA2')
      const result = await searchSchoolStudentsForCourse(lecturer, algo.id, 'zoe')
      expect(result.map((r) => r.name)).toEqual(['Zoe Candidate'])
    })

    it('lists a student once, with the most recent matricule at the school', async () => {
      const { lecturer, colleague, sch, algo } = await searchSetup()
      const older = await createClass(colleague, { schoolId: sch.id, name: 'Maths L1', academicYear: '2025/26' })
      const newer = await createClass(colleague, { schoolId: sch.id, name: 'Maths L2', academicYear: '2026/27' })
      const zoe = await studentCtx({ name: 'Zoe Twice' })
      await enroll(zoe, older.studentCode!, 'OLD1')
      await enroll(zoe, newer.studentCode!, 'NEW1')
      expect(await searchSchoolStudentsForCourse(lecturer, algo.id, 'twice')).toEqual([
        { studentId: zoe.user.id, name: 'Zoe Twice', matricule: 'NEW1' },
      ])
      // An older matricule still finds the student.
      expect(await searchSchoolStudentsForCourse(lecturer, algo.id, 'old1')).toHaveLength(1)
    })

    it('needs at least 2 characters and treats LIKE wildcards literally', async () => {
      const { lecturer, algo, colleagueClass } = await searchSetup()
      await enroll(await studentCtx({ name: 'Zoe Short' }), colleagueClass.studentCode!, 'SH1')
      expect(await searchSchoolStudentsForCourse(lecturer, algo.id, ' z ')).toEqual([])
      expect(await searchSchoolStudentsForCourse(lecturer, algo.id, '%%')).toEqual([])
      expect(await searchSchoolStudentsForCourse(lecturer, algo.id, '__')).toEqual([])
    })

    it('caps results at 10, ordered by name then matricule', async () => {
      const { lecturer, algo, colleagueClass } = await searchSetup()
      for (let i = 15; i >= 1; i--) {
        const n = String(i).padStart(2, '0')
        await enroll(await studentCtx({ name: `Capped ${n}` }), colleagueClass.studentCode!, `CAP${n}`)
      }
      const result = await searchSchoolStudentsForCourse(lecturer, algo.id, 'capped')
      expect(result).toHaveLength(10)
      expect(result.map((r) => r.matricule)).toEqual(
        Array.from({ length: 10 }, (_, i) => `CAP${String(i + 1).padStart(2, '0')}`),
      )
    })

    it("returns nothing while the course's own class has no active student", async () => {
      const { lecturer, sch, algo, cls, colleagueClass } = await searchSetup()
      const zoe = await studentCtx({ name: 'Zoe Candidate' })
      await enroll(zoe, colleagueClass.studentCode!, 'MA21X07')
      expect(await searchSchoolStudentsForCourse(lecturer, algo.id, 'zoe')).toHaveLength(1)

      // A course in an empty class at the same school: no search at all.
      const emptyClass = await createClass(lecturer, { schoolId: sch.id, name: 'CS L1', academicYear: '2026/27' })
      const emptyCourse = await createCourse(lecturer, { classId: emptyClass.id, title: 'Intro', semester: 1 })
      expect(await searchSchoolStudentsForCourse(lecturer, emptyCourse.id, 'zoe')).toEqual([])
      expect(await searchSchoolStudentsForCourse(lecturer, emptyCourse.id, 'MA21X07')).toEqual([])

      // Removed students do not count: once the class's only student is removed, search closes.
      const [anchor] = (await getCourseRoster(lecturer, algo.id)).filter((r) => r.source === 'class')
      await removeStudentFromClass(lecturer, cls.id, anchor.studentId)
      expect(await searchSchoolStudentsForCourse(lecturer, algo.id, 'zoe')).toEqual([])
    })

    it('matches names from 3 characters, matricules from 2', async () => {
      const { lecturer, algo, colleagueClass } = await searchSetup()
      const zoe = await studentCtx({ name: 'Zoe Nkemelu' })
      await enroll(zoe, colleagueClass.studentCode!, 'ZO77')
      const other = await studentCtx({ name: 'Paul Zoeller' })
      await enroll(other, colleagueClass.studentCode!, 'PZ1')
      // "zo" is in both names but only in Zoe's matricule: a 2-character query never matches names.
      expect((await searchSchoolStudentsForCourse(lecturer, algo.id, 'zo')).map((r) => r.name)).toEqual(['Zoe Nkemelu'])
      expect((await searchSchoolStudentsForCourse(lecturer, algo.id, ' zo ')).map((r) => r.name)).toEqual([
        'Zoe Nkemelu',
      ])
      expect((await searchSchoolStudentsForCourse(lecturer, algo.id, 'nk')).map((r) => r.name)).toEqual([])
      expect((await searchSchoolStudentsForCourse(lecturer, algo.id, 'zoe')).map((r) => r.name)).toEqual([
        'Paul Zoeller',
        'Zoe Nkemelu',
      ])
    })

    it('is owner-only: a colleague, a student and an unknown course are FORBIDDEN', async () => {
      const { lecturer, colleague, algo, cls } = await searchSetup()
      const student = await studentCtx()
      await enroll(student, cls.studentCode!, 'ST1')
      for (const ctx of [colleague, student]) {
        await expect(searchSchoolStudentsForCourse(ctx, algo.id, 'zoe')).rejects.toMatchObject({ code: 'FORBIDDEN' })
        await expect(searchSchoolStudentsForCourse(ctx, algo.id, 'z')).rejects.toMatchObject({ code: 'FORBIDDEN' })
      }
      await expect(searchSchoolStudentsForCourse(lecturer, 'no-such-course', 'zoe')).rejects.toMatchObject({
        code: 'FORBIDDEN',
      })
    })
  })
})
