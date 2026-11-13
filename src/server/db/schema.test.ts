import { sql } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'
import { createTestDb } from '@/test/db'
import { makeUser } from '@/test/factories'
import {
  adminAction,
  assignment,
  assignmentAttachment,
  assignmentReminder,
  attendanceCheckIn,
  attendanceCodeFailure,
  attendanceOverride,
  attendanceSession,
  attendanceWindow,
  class_,
  classDateStatus,
  classNotice,
  classExtra,
  classSlot,
  classStudent,
  course,
  courseCaSettings,
  courseRosterAdjustment,
  courseTest,
  file,
  notificationPreference,
  opsEvent,
  participationEvent,
  pushCooldown,
  pushSubscription,
  resource,
  revisionGroup,
  revisionOption,
  revisionQuestion,
  resourcePlacement,
  courseTopic,
  school,
  submission,
  submissionFile,
  testAnswer,
  testAttempt,
  testExit,
  testLog,
  testOption,
  testQuestion,
  user,
} from './schema'

async function seedClass(db: Awaited<ReturnType<typeof createTestDb>>) {
  const owner = await makeUser(db)
  const [s] = await db
    .insert(school)
    .values({ name: 'Lycee A', town: 'Douala', nameKey: 'lycee a', townKey: 'douala', createdBy: owner.id })
    .returning()
  const [c] = await db
    .insert(class_)
    .values({
      schoolId: s.id,
      name: 'L1',
      academicYear: '2026/27',
      studentCode: 'STU-1',
      lecturerCode: 'LEC-1',
      createdBy: owner.id,
    })
    .returning()
  return { owner, school: s, cls: c }
}

/** The SQLSTATE of a failed query (drizzle wraps the driver error, which sits on `cause`). */
async function sqlState(p: Promise<unknown>): Promise<string | undefined> {
  try {
    await p
  } catch (e) {
    return (e as { cause?: { code?: string } }).cause?.code
  }
  return undefined
}

async function seedSession(db: Awaited<ReturnType<typeof createTestDb>>) {
  const { owner, cls } = await seedClass(db)
  const [c] = await db
    .insert(course)
    .values({ classId: cls.id, lecturerId: owner.id, title: 'Maths', semester: 1 })
    .returning()
  const [session] = await db
    .insert(attendanceSession)
    .values({ courseId: c.id, createdBy: owner.id })
    .returning()
  return { owner, cls, course: c, session }
}

async function seedAssignment(db: Awaited<ReturnType<typeof createTestDb>>) {
  const { owner, cls } = await seedClass(db)
  const [c] = await db
    .insert(course)
    .values({ classId: cls.id, lecturerId: owner.id, title: 'Maths', semester: 1 })
    .returning()
  const [a] = await db
    .insert(assignment)
    .values({
      courseId: c.id,
      title: 'Essay',
      dueAt: new Date('2026-12-01T10:00:00Z'),
      maxMark: 20,
      submissionMode: 'both',
      createdBy: owner.id,
    })
    .returning()
  return { owner, course: c, assignment: a }
}

describe('schema', () => {
  it('migrations apply to a fresh database', async () => {
    const db = await createTestDb()
    expect(await db.select().from(school)).toEqual([])
  })

  it('rejects a user with an unknown role or locale', async () => {
    const db = await createTestDb()
    const row = { id: 'u-check', name: 'N', email: 'check@example.com', role: 'student', locale: 'en' }
    await expect(db.insert(user).values({ ...row, role: 'admin' })).rejects.toThrow()
    await expect(db.insert(user).values({ ...row, locale: 'de' })).rejects.toThrow()
    await db.insert(user).values(row)
  })

  it('stores app timestamps with time zone', async () => {
    const db = await createTestDb()
    const res = await db.execute(sql`
      select table_name, column_name, data_type from information_schema.columns
      where table_schema = 'public'
        and (table_name, column_name) in (
          ('school','created_at'), ('class','created_at'), ('class_student','joined_at'),
          ('course','created_at'), ('course_roster_adjustment','created_at'))`)
    const rows = (res as unknown as { rows: { data_type: string }[] }).rows
    expect(rows).toHaveLength(5)
    for (const r of rows) expect(r.data_type).toBe('timestamp with time zone')
  })

  it('rejects two schools with the same name_key and town_key', async () => {
    const db = await createTestDb()
    const owner = await makeUser(db)
    const row = { name: 'Lycee A', town: 'Douala', nameKey: 'lycee a', townKey: 'douala', createdBy: owner.id }
    await db.insert(school).values(row)
    await expect(db.insert(school).values({ ...row, name: 'LYCEE  A' })).rejects.toThrow()
  })

  it('rejects two students with the same matricule in one class', async () => {
    const db = await createTestDb()
    const { cls } = await seedClass(db)
    const a = await makeUser(db, { role: 'student' })
    const b = await makeUser(db, { role: 'student' })
    await db.insert(classStudent).values({ classId: cls.id, userId: a.id, matricule: 'M001' })
    await expect(
      db.insert(classStudent).values({ classId: cls.id, userId: b.id, matricule: 'M001' }),
    ).rejects.toThrow()
  })

  it('lets a removed row and an active row share a matricule, but never two active rows', async () => {
    const db = await createTestDb()
    const { cls } = await seedClass(db)
    const a = await makeUser(db, { role: 'student' })
    const b = await makeUser(db, { role: 'student' })
    const c = await makeUser(db, { role: 'student' })
    await db.insert(classStudent).values({ classId: cls.id, userId: a.id, matricule: 'M001', status: 'removed' })
    await db.insert(classStudent).values({ classId: cls.id, userId: b.id, matricule: 'M001' })
    await expect(
      db.insert(classStudent).values({ classId: cls.id, userId: c.id, matricule: 'M001' }),
    ).rejects.toThrow()
  })

  it('has the foreign-key and lookup indexes', async () => {
    const db = await createTestDb()
    const res = await db.execute(sql`
      select tablename, indexdef from pg_indexes where schemaname = 'public'`)
    const defs = (res as unknown as { rows: { tablename: string; indexdef: string }[] }).rows.map((r) =>
      r.indexdef.replace(/"/g, ''),
    )
    const expected: [string, string][] = [
      ['class_lecturer', 'user_id'],
      ['class_student', 'user_id'],
      ['class', 'school_id'],
      ['course', 'lecturer_id'],
      ['course', 'class_id'],
      ['course_roster_adjustment', 'student_id'],
      ['session', 'user_id'],
      ['account', 'user_id'],
      ['verification', 'identifier'],
    ]
    for (const [table, column] of expected) {
      const found = defs.some((d) => d.includes(` ON public.${table} USING btree (${column})`))
      expect(found, `${table}(${column})`).toBe(true)
    }
    const matricule = defs.find((d) => d.includes('class_student_active_matricule_unique'))
    expect(matricule).toMatch(/CREATE UNIQUE INDEX .* \(class_id, matricule\) WHERE \(status = 'active'::text\)/)
  })

  it('rejects an invalid class_student status', async () => {
    const db = await createTestDb()
    const { cls } = await seedClass(db)
    const a = await makeUser(db, { role: 'student' })
    await expect(
      db.execute(
        sql`insert into class_student (class_id, user_id, matricule, status) values (${cls.id}, ${a.id}, 'M1', 'banned')`,
      ),
    ).rejects.toThrow()
  })

  it('rejects an invalid roster adjustment kind and out-of-range semester', async () => {
    const db = await createTestDb()
    const { owner, cls } = await seedClass(db)
    const st = await makeUser(db, { role: 'student' })
    await expect(
      db.insert(course).values({ classId: cls.id, lecturerId: owner.id, title: 'Maths', semester: 4 }),
    ).rejects.toThrow()
    const [c] = await db
      .insert(course)
      .values({ classId: cls.id, lecturerId: owner.id, title: 'Maths', semester: 2 })
      .returning()
    await expect(
      db.execute(
        sql`insert into course_roster_adjustment (course_id, student_id, kind, created_by) values (${c.id}, ${st.id}, 'maybe', ${owner.id})`,
      ),
    ).rejects.toThrow()
    await db
      .insert(courseRosterAdjustment)
      .values({ courseId: c.id, studentId: st.id, kind: 'include', createdBy: owner.id })
  })

  it('allows one start and one end window per session, not two starts', async () => {
    const db = await createTestDb()
    const { owner, session } = await seedSession(db)
    const base = { sessionId: session.id, secret: 's3cret', openedBy: owner.id }
    await db.insert(attendanceWindow).values({ ...base, kind: 'start' })
    await db.insert(attendanceWindow).values({ ...base, kind: 'end' })
    expect(await sqlState(db.insert(attendanceWindow).values({ ...base, kind: 'start' }))).toBe('23505')
  })

  it('rejects a window kind other than start/end', async () => {
    const db = await createTestDb()
    const { owner, session } = await seedSession(db)
    expect(
      await sqlState(
        db.execute(
          sql`insert into attendance_window (id, session_id, kind, secret, opened_by) values ('w1', ${session.id}, 'middle', 'x', ${owner.id})`,
        ),
      ),
    ).toBe('23514')
  })

  it('rejects an override status other than present/partial/absent', async () => {
    const db = await createTestDb()
    const { owner, session } = await seedSession(db)
    const st = await makeUser(db, { role: 'student' })
    expect(
      await sqlState(
        db.execute(
          sql`insert into attendance_override (session_id, student_id, status, set_by) values (${session.id}, ${st.id}, 'late', ${owner.id})`,
        ),
      ),
    ).toBe('23514')
    await db
      .insert(attendanceOverride)
      .values({ sessionId: session.id, studentId: st.id, status: 'partial', setBy: owner.id })
  })

  it('deleting a session removes its windows, check-ins, overrides and code failures', async () => {
    const db = await createTestDb()
    const { owner, session } = await seedSession(db)
    const st = await makeUser(db, { role: 'student' })
    const [w] = await db
      .insert(attendanceWindow)
      .values({ sessionId: session.id, kind: 'start', secret: 's', openedBy: owner.id })
      .returning()
    await db.insert(attendanceCheckIn).values({ windowId: w.id, studentId: st.id, latitude: 4.05, longitude: 9.7, accuracyM: 12 })
    await db.insert(attendanceCodeFailure).values({ windowId: w.id, studentId: st.id, failures: 2 })
    await db
      .insert(attendanceOverride)
      .values({ sessionId: session.id, studentId: st.id, status: 'present', setBy: owner.id })
    await db.delete(attendanceSession)
    expect(await db.select().from(attendanceWindow)).toHaveLength(0)
    expect(await db.select().from(attendanceCheckIn)).toHaveLength(0)
    expect(await db.select().from(attendanceOverride)).toHaveLength(0)
    expect(await db.select().from(attendanceCodeFailure)).toHaveLength(0)
  })

  it('has the attendance lookup indexes', async () => {
    const db = await createTestDb()
    const res = await db.execute(sql`select indexdef from pg_indexes where schemaname = 'public'`)
    const defs = (res as unknown as { rows: { indexdef: string }[] }).rows.map((r) => r.indexdef.replace(/"/g, ''))
    for (const [table, column] of [
      ['attendance_session', 'course_id'],
      ['attendance_window', 'session_id'],
      ['attendance_check_in', 'student_id'],
    ]) {
      expect(
        defs.some((d) => d.includes(` ON public.${table} USING btree (${column})`)),
        `${table}(${column})`,
      ).toBe(true)
    }
  })

  it('applies assignment defaults and keeps numbers as numbers', async () => {
    const db = await createTestDb()
    const { assignment: a } = await seedAssignment(db)
    expect(a).toMatchObject({
      instructions: [],
      weight: 1,
      maxMark: 20,
      latePolicy: 'accept',
      status: 'draft',
      publishedAt: null,
      gradesReleasedAt: null,
    })
  })

  it('one submission per student per assignment', async () => {
    const db = await createTestDb()
    const { assignment: a } = await seedAssignment(db)
    const st = await makeUser(db, { role: 'student' })
    const row = { assignmentId: a.id, studentId: st.id, submittedAt: new Date() }
    await db.insert(submission).values(row)
    expect(await sqlState(db.insert(submission).values(row))).toBe('23505')
  })

  it('rejects unknown submission mode, late policy, status and file purpose', async () => {
    const db = await createTestDb()
    const { owner, course: c } = await seedAssignment(db)
    const base = {
      courseId: c.id,
      title: 'T',
      dueAt: new Date(),
      maxMark: 10,
      submissionMode: 'files' as const,
      createdBy: owner.id,
    }
    for (const bad of [{ submissionMode: 'video' }, { latePolicy: 'maybe' }, { status: 'archived' }]) {
      expect(
        await sqlState(db.insert(assignment).values({ ...base, ...bad } as never)),
        JSON.stringify(bad),
      ).toBe('23514')
    }
    expect(
      await sqlState(
        db.insert(file).values({
          ownerId: owner.id,
          purpose: 'avatar',
          storageKey: 'k1',
          name: 'a.pdf',
          mimeType: 'application/pdf',
          sizeBytes: 1,
        } as never),
      ),
    ).toBe('23514')
  })

  it('deleting an assignment removes attachments, submissions, submission file links and reminders', async () => {
    const db = await createTestDb()
    const { owner, assignment: a } = await seedAssignment(db)
    const st = await makeUser(db, { role: 'student' })
    const mk = (key: string, purpose: 'assignment' | 'submission') => ({
      ownerId: owner.id,
      purpose,
      storageKey: key,
      name: `${key}.pdf`,
      mimeType: 'application/pdf',
      sizeBytes: 10,
    })
    const [f1, f2] = await db
      .insert(file)
      .values([mk('k-a', 'assignment'), mk('k-s', 'submission')])
      .returning()
    await db.insert(assignmentAttachment).values({ assignmentId: a.id, fileId: f1.id, position: 0 })
    const [sub] = await db
      .insert(submission)
      .values({ assignmentId: a.id, studentId: st.id, submittedAt: new Date() })
      .returning()
    await db.insert(submissionFile).values({ submissionId: sub.id, fileId: f2.id, position: 0 })
    await db.insert(assignmentReminder).values({ assignmentId: a.id, studentId: st.id, sentAt: new Date() })
    await db.delete(assignment)
    expect(await db.select().from(assignmentAttachment)).toHaveLength(0)
    expect(await db.select().from(submission)).toHaveLength(0)
    expect(await db.select().from(submissionFile)).toHaveLength(0)
    expect(await db.select().from(assignmentReminder)).toHaveLength(0)
    expect(await db.select().from(file)).toHaveLength(2)
  })

  it('has the assignment lookup indexes', async () => {
    const db = await createTestDb()
    const res = await db.execute(sql`select indexdef from pg_indexes where schemaname = 'public'`)
    const defs = (res as unknown as { rows: { indexdef: string }[] }).rows.map((r) => r.indexdef.replace(/"/g, ''))
    for (const [table, columns] of [
      ['file', 'owner_id'],
      ['assignment', 'course_id'],
      ['assignment', 'status, due_at'],
      ['submission', 'student_id'],
    ]) {
      expect(
        defs.some((d) => d.includes(` ON public.${table} USING btree (${columns})`)),
        `${table}(${columns})`,
      ).toBe(true)
    }
  })

  it('applies CA settings defaults and keeps numbers as numbers', async () => {
    const db = await createTestDb()
    const { owner, course: c } = await seedSession(db)
    const [row] = await db
      .insert(courseCaSettings)
      .values({
        courseId: c.id,
        total: 30,
        attendancePoints: 5,
        assignmentPoints: 20,
        participationPoints: 5,
        testPoints: 0,
        updatedBy: owner.id,
      })
      .returning()
    expect(row.total).toBe(30)
    expect(row.attendancePoints).toBe(5)
    expect(row.participationTarget).toBe(5)
    expect(row.testsBestOf).toBeNull()
    expect(row.updatedAt).toBeInstanceOf(Date)
  })

  it('rejects CA settings that break the CHECKs (total 0, negative points, target out of range)', async () => {
    const db = await createTestDb()
    const { owner, course: c } = await seedSession(db)
    const ok = {
      courseId: c.id,
      total: 30,
      attendancePoints: 5,
      assignmentPoints: 20,
      participationPoints: 5,
      testPoints: 0,
      updatedBy: owner.id,
    }
    for (const bad of [
      { total: 0 },
      { attendancePoints: -1 },
      { assignmentPoints: -1 },
      { participationPoints: -1 },
      { testPoints: -1 },
      { participationTarget: 0 },
      { participationTarget: 101 },
      { testsBestOf: 0 },
      { testsBestOf: 51 },
    ]) {
      expect(await sqlState(db.insert(courseCaSettings).values({ ...ok, ...bad })), JSON.stringify(bad)).toBe('23514')
    }
    expect(await db.select().from(courseCaSettings)).toHaveLength(0)
  })

  it('one CA settings row per course', async () => {
    const db = await createTestDb()
    const { owner, course: c } = await seedSession(db)
    const row = {
      courseId: c.id,
      total: 30,
      attendancePoints: 5,
      assignmentPoints: 20,
      participationPoints: 5,
      testPoints: 0,
      updatedBy: owner.id,
    }
    await db.insert(courseCaSettings).values(row)
    expect(await sqlState(db.insert(courseCaSettings).values(row))).toBe('23505')
  })

  it('rejects a participation delta other than -1 or 1', async () => {
    const db = await createTestDb()
    const { owner, course: c } = await seedSession(db)
    const st = await makeUser(db, { role: 'student' })
    const ev = { courseId: c.id, studentId: st.id, createdBy: owner.id }
    for (const delta of [2, 0, -2]) {
      expect(await sqlState(db.insert(participationEvent).values({ ...ev, delta })), `delta ${delta}`).toBe('23514')
    }
    await db.insert(participationEvent).values([
      { ...ev, delta: 1 },
      { ...ev, delta: -1 },
    ])
    expect(await db.select().from(participationEvent)).toHaveLength(2)
  })

  it('deleting a course removes its CA settings and participation events', async () => {
    const db = await createTestDb()
    const { owner, course: c } = await seedSession(db)
    const st = await makeUser(db, { role: 'student' })
    await db.insert(courseCaSettings).values({
      courseId: c.id,
      total: 30,
      attendancePoints: 5,
      assignmentPoints: 20,
      participationPoints: 5,
      testPoints: 0,
      updatedBy: owner.id,
    })
    await db.insert(participationEvent).values({ courseId: c.id, studentId: st.id, delta: 1, createdBy: owner.id })
    await db.delete(course)
    expect(await db.select().from(courseCaSettings)).toHaveLength(0)
    expect(await db.select().from(participationEvent)).toHaveLength(0)
    expect(await db.select().from(user)).toHaveLength(2)
  })

  it('has the participation lookup indexes', async () => {
    const db = await createTestDb()
    const res = await db.execute(sql`select indexdef from pg_indexes where schemaname = 'public'`)
    const defs = (res as unknown as { rows: { indexdef: string }[] }).rows.map((r) => r.indexdef.replace(/"/g, ''))
    for (const columns of ['course_id, student_id', 'course_id, created_by, created_at']) {
      expect(
        defs.some((d) => d.includes(` ON public.participation_event USING btree (${columns})`)),
        `participation_event(${columns})`,
      ).toBe(true)
    }
  })

  async function seedTest(db: Awaited<ReturnType<typeof createTestDb>>, code = 'ABC123') {
    const { owner, course: c } = await seedSession(db)
    const [t] = await db
      .insert(courseTest)
      .values({
        courseId: c.id,
        code,
        title: 'CA 1',
        durationMinutes: 30,
        defaultMark: 2,
        createdBy: owner.id,
      })
      .returning()
    const [q] = await db
      .insert(testQuestion)
      .values({ testId: t.id, position: 0, kind: 'mcq', prompt: '1+1?' })
      .returning()
    return { owner, course: c, test: t, question: q }
  }

  it('applies test defaults and keeps numbers as numbers', async () => {
    const db = await createTestDb()
    const { test: t, question: q } = await seedTest(db)
    expect(t).toMatchObject({
      defaultMark: 2,
      weight: 1,
      shuffle: true,
      maxExits: 3,
      maxAbsenceSeconds: 10,
      startedAt: null,
      deadlineAt: null,
      endedAt: null,
      resultsReleasedAt: null,
      copiedFromId: null,
    })
    expect(q.mark).toBeNull()
  })

  it('rejects a second test with the same code', async () => {
    const db = await createTestDb()
    const { owner, course: c } = await seedTest(db, 'SAME01')
    const row = {
      courseId: c.id,
      code: 'SAME01',
      title: 'CA 2',
      durationMinutes: 30,
      defaultMark: 2,
      createdBy: owner.id,
    }
    expect(await sqlState(db.insert(courseTest).values(row))).toBe('23505')
  })

  it('rejects two correct options on one question, but allows many wrong ones', async () => {
    const db = await createTestDb()
    const { question: q } = await seedTest(db)
    await db.insert(testOption).values([
      { questionId: q.id, position: 0, text: '2', isCorrect: true },
      { questionId: q.id, position: 1, text: '3' },
      { questionId: q.id, position: 2, text: '4' },
    ])
    expect(
      await sqlState(
        db.insert(testOption).values({
          questionId: q.id,
          position: 3,
          text: '5',
          isCorrect: true,
        }),
      ),
    ).toBe('23505')
  })

  it('rejects a second attempt by the same student on a test', async () => {
    const db = await createTestDb()
    const { test: t } = await seedTest(db)
    const st = await makeUser(db, { role: 'student' })
    const row = {
      testId: t.id,
      studentId: st.id,
      seed: 's',
      deviceId: 'd',
      deviceSeenAt: new Date(),
    }
    const [a] = await db.insert(testAttempt).values(row).returning()
    expect(a).toMatchObject({
      closedAt: null,
      closedReason: null,
      exitsSinceReopen: 0,
    })
    expect(await sqlState(db.insert(testAttempt).values(row))).toBe('23505')
  })

  it('rejects a started test without a deadline, and a deadline without a start', async () => {
    const db = await createTestDb()
    const { owner, course: c } = await seedTest(db)
    const base = {
      courseId: c.id,
      title: 'CA 2',
      durationMinutes: 30,
      defaultMark: 2,
      createdBy: owner.id,
    }
    const now = new Date()
    expect(await sqlState(db.insert(courseTest).values({ ...base, code: 'AAA111', startedAt: now }))).toBe('23514')
    expect(await sqlState(db.insert(courseTest).values({ ...base, code: 'BBB222', deadlineAt: now }))).toBe('23514')
    await db.insert(courseTest).values({
      ...base,
      code: 'CCC333',
      startedAt: now,
      deadlineAt: new Date(now.getTime() + 1000),
    })
  })

  it('rejects out-of-range duration, exits, absence and marks', async () => {
    const db = await createTestDb()
    const { owner, course: c, test: t } = await seedTest(db)
    const base = {
      courseId: c.id,
      title: 'CA 2',
      durationMinutes: 30,
      defaultMark: 2,
      createdBy: owner.id,
    }
    const bad: Record<string, object> = {
      duration0: { durationMinutes: 0 },
      duration301: { durationMinutes: 301 },
      exits0: { maxExits: 0 },
      exits11: { maxExits: 11 },
      absence2: { maxAbsenceSeconds: 2 },
      absence301: { maxAbsenceSeconds: 301 },
      defaultMark0: { defaultMark: 0 },
      weight0: { weight: 0.24 },
      weight101: { weight: 100.01 },
    }
    let n = 0
    for (const [name, over] of Object.entries(bad)) {
      n += 1
      expect(await sqlState(db.insert(courseTest).values({ ...base, code: `RNG${n}`, ...over })), name).toBe('23514')
    }
    expect(
      await sqlState(
        db.insert(testQuestion).values({
          testId: t.id,
          position: 1,
          kind: 'short',
          prompt: 'p',
          mark: 0,
        }),
      ),
    ).toBe('23514')
  })

  it('rejects a question kind other than mcq/short and a close reason other than handed_in/left', async () => {
    const db = await createTestDb()
    const { test: t } = await seedTest(db)
    expect(
      await sqlState(
        db.insert(testQuestion).values({
          testId: t.id,
          position: 1,
          kind: 'essay' as never,
          prompt: 'p',
        }),
      ),
    ).toBe('23514')
    const st = await makeUser(db, { role: 'student' })
    const row = {
      testId: t.id,
      studentId: st.id,
      seed: 's',
      deviceId: 'd',
      deviceSeenAt: new Date(),
    }
    expect(await sqlState(db.insert(testAttempt).values({ ...row, closedReason: 'quit' as never }))).toBe('23514')
    const [a] = await db
      .insert(testAttempt)
      .values({ ...row, closedAt: new Date(), closedReason: 'left' })
      .returning()
    expect(await sqlState(db.insert(testLog).values({ attemptId: a.id, kind: 'cheated' as never }))).toBe('23514')
  })

  it('keeps one answer per question per attempt, and nulls the option when it is deleted', async () => {
    const db = await createTestDb()
    const { test: t, question: q } = await seedTest(db)
    const st = await makeUser(db, { role: 'student' })
    const [a] = await db
      .insert(testAttempt)
      .values({
        testId: t.id,
        studentId: st.id,
        seed: 's',
        deviceId: 'd',
        deviceSeenAt: new Date(),
      })
      .returning()
    const [o] = await db.insert(testOption).values({ questionId: q.id, position: 0, text: '2' }).returning()
    const ans = {
      attemptId: a.id,
      questionId: q.id,
      optionId: o.id,
      rev: 1,
      receivedAt: new Date(),
    }
    await db.insert(testAnswer).values(ans)
    expect(await sqlState(db.insert(testAnswer).values(ans))).toBe('23505')
    await db.delete(testOption)
    const [row] = await db.select().from(testAnswer)
    expect(row.optionId).toBeNull()
    expect(row.mark).toBeNull()
  })

  it('rejects a negative mark or suggested mark on an answer, but allows 0 and null', async () => {
    const db = await createTestDb()
    const { test: t, question: q } = await seedTest(db)
    const st = await makeUser(db, { role: 'student' })
    const [a] = await db
      .insert(testAttempt)
      .values({ testId: t.id, studentId: st.id, seed: 's', deviceId: 'd', deviceSeenAt: new Date() })
      .returning()
    const ans = { attemptId: a.id, questionId: q.id, text: 'two', rev: 1, receivedAt: new Date() }
    expect(await sqlState(db.insert(testAnswer).values({ ...ans, mark: -0.25 })), 'mark').toBe('23514')
    expect(await sqlState(db.insert(testAnswer).values({ ...ans, suggestedMark: -1 })), 'suggested').toBe('23514')
    await db.insert(testAnswer).values({ ...ans, mark: 0, suggestedMark: 0 })
    expect(await sqlState(db.update(testAnswer).set({ mark: -1 }))).toBe('23514')
    expect(await sqlState(db.update(testAnswer).set({ suggestedMark: -0.5 }))).toBe('23514')
    await db.update(testAnswer).set({ mark: null, suggestedMark: null })
    const [row] = await db.select().from(testAnswer)
    expect(row).toMatchObject({ mark: null, suggestedMark: null })
  })

  it('sets copied_from to null when the source test is deleted', async () => {
    const db = await createTestDb()
    const { owner, course: c, test: t } = await seedTest(db)
    const [copy] = await db
      .insert(courseTest)
      .values({
        courseId: c.id,
        code: 'COPY01',
        title: 'CA 1',
        durationMinutes: 30,
        defaultMark: 2,
        createdBy: owner.id,
        copiedFromId: t.id,
      })
      .returning()
    await db.delete(courseTest).where(sql`${courseTest.id} = ${t.id}`)
    const [after] = await db.select().from(courseTest)
    expect(after.id).toBe(copy.id)
    expect(after.copiedFromId).toBeNull()
  })

  it('deleting a course removes its tests, questions, options, attempts, answers, exits and log', async () => {
    const db = await createTestDb()
    const { owner, test: t, question: q } = await seedTest(db)
    const st = await makeUser(db, { role: 'student' })
    const [o] = await db
      .insert(testOption)
      .values({ questionId: q.id, position: 0, text: '2', isCorrect: true })
      .returning()
    const [a] = await db
      .insert(testAttempt)
      .values({
        testId: t.id,
        studentId: st.id,
        seed: 's',
        deviceId: 'd',
        deviceSeenAt: new Date(),
      })
      .returning()
    await db.insert(testAnswer).values({
      attemptId: a.id,
      questionId: q.id,
      optionId: o.id,
      rev: 1,
      receivedAt: new Date(),
    })
    await db.insert(testExit).values({
      attemptId: a.id,
      exitId: crypto.randomUUID(),
      exitNumber: 1,
      firstReportedAt: new Date(),
    })
    await db.insert(testLog).values({ attemptId: a.id, kind: 'reopened', byUserId: owner.id })
    await db.delete(course)
    for (const table of [courseTest, testQuestion, testOption, testAttempt, testAnswer, testExit, testLog]) {
      expect(await db.select().from(table)).toHaveLength(0)
    }
    expect(await db.select().from(user)).toHaveLength(2)
  })

  it('has the test lookup indexes', async () => {
    const db = await createTestDb()
    const res = await db.execute(sql`select indexdef from pg_indexes where schemaname = 'public'`)
    const defs = (res as unknown as { rows: { indexdef: string }[] }).rows.map((r) => r.indexdef.replace(/"/g, ''))
    const wanted: [string, string][] = [
      ['course_test', 'course_id'],
      ['test_question', 'test_id, position'],
      ['test_attempt', 'student_id'],
      ['test_answer', 'question_id'],
      ['test_log', 'attempt_id'],
    ]
    for (const [table, columns] of wanted) {
      expect(
        defs.some((d) => d.includes(` ON public.${table} USING btree (${columns})`)),
        `${table}(${columns})`,
      ).toBe(true)
    }
    expect(
      defs.some((d) => d.includes('UNIQUE') && d.includes('ON public.test_option') && d.includes('WHERE is_correct')),
    ).toBe(true)
  })

  it('rejects a link resource without a url and a url on a note', async () => {
    const db = await createTestDb()
    const { owner } = await seedClass(db)
    const base = { ownerId: owner.id, title: 'Reading' }
    expect(await sqlState(db.insert(resource).values({ ...base, kind: 'link' }))).toBe('23514')
    expect(await sqlState(db.insert(resource).values({ ...base, kind: 'note', url: 'https://example.com' }))).toBe('23514')
    expect(await sqlState(db.insert(resource).values({ ...base, kind: 'file' }))).toBe('23514')
    await db.insert(resource).values({ ...base, kind: 'link', url: 'https://example.com' })
    await db.insert(resource).values({ ...base, kind: 'note' })
  })

  it('rejects two correct revision options for one question', async () => {
    const db = await createTestDb()
    const { owner, course: c } = await seedSession(db)
    const [topic] = await db.insert(courseTopic).values({ courseId: c.id, title: 'Cells', position: 0 }).returning()
    const [group] = await db
      .insert(revisionGroup)
      .values({ courseId: c.id, topicId: topic.id, position: 0 })
      .returning()
    const [q] = await db
      .insert(revisionQuestion)
      .values({ groupId: group.id, position: 0, kind: 'mcq', prompt: '1+1?' })
      .returning()
    await db.insert(revisionOption).values([
      { questionId: q.id, position: 0, text: '2', isCorrect: true },
      { questionId: q.id, position: 1, text: '3' },
    ])
    expect(
      await sqlState(db.insert(revisionOption).values({ questionId: q.id, position: 2, text: '4', isCorrect: true })),
    ).toBe('23505')
    expect(owner.id).toBeTruthy()
  })

  it('allows one written-here group per topic and one group per imported test', async () => {
    const db = await createTestDb()
    const { course: c } = await seedSession(db)
    const [topic] = await db.insert(courseTopic).values({ courseId: c.id, title: 'Cells', position: 0 }).returning()
    await db.insert(revisionGroup).values({ courseId: c.id, topicId: topic.id, position: 0 })
    expect(
      await sqlState(db.insert(revisionGroup).values({ courseId: c.id, topicId: topic.id, position: 1 })),
    ).toBe('23505')
    // Imported groups (with a source family) are not limited per topic.
    await db
      .insert(revisionGroup)
      .values({ courseId: c.id, topicId: topic.id, position: 1, sourceFamilyId: 'fam-1', sourceTitle: 'CA 1' })
    await db
      .insert(revisionGroup)
      .values({ courseId: c.id, topicId: topic.id, position: 2, sourceFamilyId: 'fam-2', sourceTitle: 'CA 2' })
  })

  it('removes topics, placements and groups with their course', async () => {
    const db = await createTestDb()
    const { owner, course: c } = await seedSession(db)
    const [topic] = await db.insert(courseTopic).values({ courseId: c.id, title: 'Cells', position: 0 }).returning()
    const [res] = await db.insert(resource).values({ ownerId: owner.id, kind: 'note', title: 'N' }).returning()
    await db.insert(resourcePlacement).values({ resourceId: res.id, courseId: c.id, topicId: topic.id, position: 0 })
    await db.insert(revisionGroup).values({ courseId: c.id, topicId: topic.id, position: 0 })
    await db.delete(course)
    for (const table of [courseTopic, resourcePlacement, revisionGroup]) {
      expect(await db.select().from(table)).toHaveLength(0)
    }
    expect(await db.select().from(resource)).toHaveLength(1)
  })
})

describe('admin schema', () => {
  it('stores an audit row and refuses an unknown action', async () => {
    const db = await createTestDb()
    const admin = await makeUser(db)
    const target = await makeUser(db)
    const id = crypto.randomUUID()
    await db.insert(adminAction).values({ id, adminId: admin.id, action: 'suspend', targetUserId: target.id, reason: 'spam' })
    const [row] = await db.select().from(adminAction)
    expect(row).toMatchObject({ id, adminId: admin.id, action: 'suspend', targetUserId: target.id, reason: 'spam' })
    expect(row.at).toBeInstanceOf(Date)
    await expect(
      db.insert(adminAction).values({
        id: crypto.randomUUID(),
        adminId: admin.id,
        action: 'delete' as 'suspend',
        targetUserId: target.id,
      }),
    ).rejects.toThrow()
  })

  it('stores an ops event and refuses an unknown kind', async () => {
    const db = await createTestDb()
    const id = crypto.randomUUID()
    const detail = { kind: 'verify', to: 'a***@example.com' }
    await db.insert(opsEvent).values({ id, kind: 'email_sent', ok: true, detail })
    const [row] = await db.select().from(opsEvent)
    expect(row.detail).toEqual(detail)
    expect(row.ok).toBe(true)
    await expect(
      db.insert(opsEvent).values({ id: crypto.randomUUID(), kind: 'other' as 'email_sent', ok: true }),
    ).rejects.toThrow()
  })

  it('stores one push subscription per endpoint', async () => {
    const db = await createTestDb()
    const u = await makeUser(db)
    const values = { userId: u.id, endpoint: 'https://push.example/abc', p256dh: 'k', auth: 'a', label: 'Chrome on Windows' }
    await db.insert(pushSubscription).values(values)
    const [row] = await db.select().from(pushSubscription)
    expect(row).toMatchObject({ failureCount: 0, lastSuccessAt: null })
    expect(row.createdAt).toBeInstanceOf(Date)
    await expect(db.insert(pushSubscription).values(values)).rejects.toThrow()
    await db.insert(pushCooldown).values({ key: 'k1', until: new Date() })
    expect(await db.select().from(pushCooldown)).toHaveLength(1)
  })

  it('deletes push subscriptions with their user', async () => {
    const db = await createTestDb()
    const u = await makeUser(db)
    await db
      .insert(pushSubscription)
      .values({ userId: u.id, endpoint: 'https://push.example/x', p256dh: 'k', auth: 'a', label: 'Phone' })
    await db.delete(user).where(sql`${user.id} = ${u.id}`)
    expect(await db.select().from(pushSubscription)).toHaveLength(0)
  })

  it('accepts push_sent and push_failed ops events', async () => {
    const db = await createTestDb()
    await db.insert(opsEvent).values([
      { id: crypto.randomUUID(), kind: 'push_sent', ok: true },
      { id: crypto.randomUUID(), kind: 'push_failed', ok: false },
    ])
    expect(await db.select().from(opsEvent)).toHaveLength(2)
  })

  it('user has the activity and suspension columns, null by default', async () => {
    const db = await createTestDb()
    const u = await makeUser(db)
    const [row] = await db
      .select({
        lastSignInAt: user.lastSignInAt,
        lastSeenAt: user.lastSeenAt,
        suspendedAt: user.suspendedAt,
        suspendedReason: user.suspendedReason,
      })
      .from(user)
      .where(sql`${user.id} = ${u.id}`)
    expect(row).toEqual({ lastSignInAt: null, lastSeenAt: null, suspendedAt: null, suspendedReason: null })
  })
})

describe('schedule', () => {
  async function seedSlot(db: Awaited<ReturnType<typeof createTestDb>>) {
    const { owner, cls } = await seedClass(db)
    const [c] = await db
      .insert(course)
      .values({ classId: cls.id, lecturerId: owner.id, title: 'Maths', semester: 1 })
      .returning()
    const slot = {
      courseId: c.id,
      weekday: 2,
      startMinute: 480,
      endMinute: 600,
      startsOn: '2026-11-01',
      endsOn: '2027-02-28',
      createdBy: owner.id,
    }
    return { owner, course: c, slot }
  }

  it('rejects a slot that ends before it starts', async () => {
    const db = await createTestDb()
    const { slot } = await seedSlot(db)
    expect(await sqlState(db.insert(classSlot).values({ ...slot, startMinute: 600, endMinute: 480 }))).toBe('23514')
    expect(await sqlState(db.insert(classSlot).values({ ...slot, endMinute: 1441 }))).toBe('23514')
    expect(await sqlState(db.insert(classSlot).values({ ...slot, endsOn: '2026-10-31' }))).toBe('23514')
    await db.insert(classSlot).values(slot)
    const [row] = await db.select().from(classSlot)
    expect(row).toMatchObject({ room: null, requireOnCampus: false, startsOn: '2026-11-01' })
  })

  it('rejects a weekday outside 1-7', async () => {
    const db = await createTestDb()
    const { slot } = await seedSlot(db)
    expect(await sqlState(db.insert(classSlot).values({ ...slot, weekday: 0 }))).toBe('23514')
    expect(await sqlState(db.insert(classSlot).values({ ...slot, weekday: 8 }))).toBe('23514')
  })

  it('allows one status per slot and date', async () => {
    const db = await createTestDb()
    const { owner, slot } = await seedSlot(db)
    const [s] = await db.insert(classSlot).values(slot).returning()
    const row = { slotId: s.id, date: '2026-11-10', status: 'cancelled' as const, setBy: owner.id }
    await db.insert(classDateStatus).values(row)
    expect(await sqlState(db.insert(classDateStatus).values({ ...row, status: 'taught' }))).toBe('23505')
    expect(await sqlState(db.insert(classDateStatus).values({ ...row, date: '2026-11-17', status: 'bad' as never }))).toBe(
      '23514',
    )
  })

  it('rejects an extra with replacesSlotId but no replacesDate', async () => {
    const db = await createTestDb()
    const { owner, course: c, slot } = await seedSlot(db)
    const [s] = await db.insert(classSlot).values(slot).returning()
    const extra = {
      courseId: c.id,
      startsAt: new Date('2026-11-12T08:00:00Z'),
      endsAt: new Date('2026-11-12T10:00:00Z'),
      createdBy: owner.id,
    }
    expect(await sqlState(db.insert(classExtra).values({ ...extra, replacesSlotId: s.id }))).toBe('23514')
    expect(await sqlState(db.insert(classExtra).values({ ...extra, replacesDate: '2026-11-10' }))).toBe('23514')
    expect(await sqlState(db.insert(classExtra).values({ ...extra, status: 'bad' as never }))).toBe('23514')
    expect(await sqlState(db.insert(classExtra).values({ ...extra, endsAt: extra.startsAt }))).toBe('23514')
    await db.insert(classExtra).values({ ...extra, replacesSlotId: s.id, replacesDate: '2026-11-10' })
    await db.insert(classExtra).values(extra)
  })

  it('deleting a course removes its slots, statuses and extras', async () => {
    const db = await createTestDb()
    const { owner, course: c, slot } = await seedSlot(db)
    const [s] = await db.insert(classSlot).values(slot).returning()
    await db.insert(classDateStatus).values({ slotId: s.id, date: '2026-11-10', status: 'missed', setBy: owner.id })
    await db.insert(classExtra).values({
      courseId: c.id,
      startsAt: new Date('2026-11-12T08:00:00Z'),
      endsAt: new Date('2026-11-12T10:00:00Z'),
      createdBy: owner.id,
    })
    await db.delete(course).where(sql`${course.id} = ${c.id}`)
    expect(await db.select().from(classSlot)).toHaveLength(0)
    expect(await db.select().from(classDateStatus)).toHaveLength(0)
    expect(await db.select().from(classExtra)).toHaveLength(0)
  })

  it('classReminders defaults on and notices are unique per occurrence and kind', async () => {
    const db = await createTestDb()
    const u = await makeUser(db)
    await db.insert(notificationPreference).values({ userId: u.id })
    const [pref] = await db.select().from(notificationPreference)
    expect(pref.classReminders).toBe(true)
    const notice = { occurrenceKey: 'slot:1:2026-11-10', kind: 'reminder' }
    await db.insert(classNotice).values(notice)
    expect(await sqlState(db.insert(classNotice).values(notice))).toBe('23505')
    await db.insert(classNotice).values({ ...notice, kind: 'missed' })
  })
})
