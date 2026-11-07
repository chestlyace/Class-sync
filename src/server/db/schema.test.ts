import { sql } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'
import { createTestDb } from '@/test/db'
import { makeUser } from '@/test/factories'
import {
  attendanceCheckIn,
  attendanceCodeFailure,
  attendanceOverride,
  attendanceSession,
  attendanceWindow,
  class_,
  classStudent,
  course,
  courseRosterAdjustment,
  school,
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
})
