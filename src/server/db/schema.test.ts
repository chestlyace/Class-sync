import { sql } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'
import { createTestDb } from '@/test/db'
import { makeUser } from '@/test/factories'
import { class_, classStudent, course, courseRosterAdjustment, school } from './schema'

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

describe('schema', () => {
  it('migrations apply to a fresh database', async () => {
    const db = await createTestDb()
    expect(await db.select().from(school)).toEqual([])
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
})
