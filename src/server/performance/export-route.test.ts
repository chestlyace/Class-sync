import ExcelJS from 'exceljs'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { setNowForTests } from '@/server/core/clock'
import { config, setConfigForTests } from '@/server/core/config'
import type { Ctx } from '@/server/core/context'
import { AppError } from '@/server/core/errors'
import type { Db } from '@/server/db'
import { class_, classLecturer, classStudent, course, school, user } from '@/server/db/schema'
import { createClass, joinClassAsLecturer, joinClassAsStudent } from '@/server/classes/service'
import { createCourse } from '@/server/courses/service'
import { createSchool } from '@/server/schools/service'
import { createTestDb } from '@/test/db'
import { ctxFor, makeUser } from '@/test/factories'

let current: Ctx | null = null
vi.mock('@/server/auth/session', () => ({
  getCtx: async () => {
    if (!current) throw new AppError('UNAUTHENTICATED', 'Not signed in')
    return current
  },
}))

import { GET } from '@/app/(app)/courses/[courseId]/performance/export/route'

describe('GET /courses/[courseId]/performance/export', () => {
  let db: Db
  const zone = config.timeZone
  beforeAll(async () => {
    db = await createTestDb()
  })
  beforeEach(() => {
    // 00:30 on 9 November in Africa/Douala (UTC+1).
    setNowForTests(() => new Date('2026-11-08T23:30:00Z'))
    setConfigForTests({ timeZone: 'Africa/Douala' })
  })
  afterEach(async () => {
    current = null
    setNowForTests(null)
    setConfigForTests({ timeZone: zone })
    await db.delete(course)
    await db.delete(classStudent)
    await db.delete(classLecturer)
    await db.delete(class_)
    await db.delete(school)
    await db.delete(user)
  })
  afterAll(() => {
    current = null
  })

  async function setup(courseInput: { title: string; code?: string } = { title: 'Algorithms', code: 'CS301' }) {
    const lecturer = ctxFor(db, await makeUser(db, { role: 'lecturer', name: 'Dr Owner', locale: 'fr' }))
    const sch = await createSchool(lecturer, { name: 'University of Buea', town: 'Buea' })
    const cls = await createClass(lecturer, { schoolId: sch.id, name: 'CS L3', academicYear: '2026/27' })
    const colleague = ctxFor(db, await makeUser(db, { role: 'lecturer', name: 'Dr Colleague' }))
    await joinClassAsLecturer(colleague, cls.lecturerCode!)
    const algo = await createCourse(lecturer, { classId: cls.id, ...courseInput, semester: 1 })
    const student = ctxFor(db, await makeUser(db, { role: 'student', name: 'Ada' }))
    await joinClassAsStudent(student, cls.studentCode!, 'UB2')
    const other = ctxFor(db, await makeUser(db, { role: 'student', name: 'Bob' }))
    await joinClassAsStudent(other, cls.studentCode!, 'UB1')
    return { lecturer, colleague, student, algo }
  }

  const request = (courseId: string) =>
    GET(new Request(`http://localhost/courses/${courseId}/performance/export`), {
      params: Promise.resolve({ courseId }),
    } as Parameters<typeof GET>[1])

  it('gives the owner an .xlsx in their language, rows in matricule order', async () => {
    const { lecturer, algo } = await setup()
    current = lecturer
    const res = await request(algo.id)

    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toBe(
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    )
    expect(res.headers.get('cache-control')).toBe('private, no-store')
    expect(res.headers.get('x-content-type-options')).toBe('nosniff')
    expect(res.headers.get('content-disposition')).toBe(
      `attachment; filename="CA-CS301-2026-11-09.xlsx"; filename*=UTF-8''CA-CS301-2026-11-09.xlsx`,
    )

    const wb = new ExcelJS.Workbook()
    await wb.xlsx.load((await res.arrayBuffer()) as ArrayBuffer)
    const ws = wb.getWorksheet('CA')!
    expect((ws.getRow(1).values as unknown[]).slice(1)).toEqual([
      'Matricule',
      'Nom',
      'Présence (/5)',
      'Devoirs (/20)',
      'Participation (/5)',
      'CA (/30)',
    ])
    expect([2, 3].map((r) => [ws.getRow(r).getCell(1).value, ws.getRow(r).getCell(2).value])).toEqual([
      ['UB1', 'Bob'],
      ['UB2', 'Ada'],
    ])
  })

  it('names the file after the title when the course has no code, with an RFC 5987 name for accents', async () => {
    const { lecturer, algo } = await setup({ title: 'Génie logiciel' })
    current = lecturer
    const res = await request(algo.id)
    expect(res.status).toBe(200)
    expect(res.headers.get('content-disposition')).toBe(
      `attachment; filename="CA-Genie-logiciel-2026-11-09.xlsx"; filename*=UTF-8''CA-G%C3%A9nie-logiciel-2026-11-09.xlsx`,
    )
  })

  it('is 403 with a generic body for a student on the course, a colleague and a stranger', async () => {
    const { colleague, student, algo } = await setup()
    const stranger = ctxFor(db, await makeUser(db, { role: 'lecturer', name: 'Dr Stranger' }))
    for (const who of [student, colleague, stranger]) {
      current = who
      const res = await request(algo.id)
      expect(res.status).toBe(403)
      expect(res.headers.get('cache-control')).toBe('private, no-store')
      expect(res.headers.get('content-type')).not.toContain('spreadsheet')
      expect(await res.json()).toEqual({ error: 'FORBIDDEN' })
    }
  })

  it('is 403 for a course that does not exist (same as not yours)', async () => {
    const { lecturer } = await setup()
    current = lecturer
    const res = await request(crypto.randomUUID())
    expect(res.status).toBe(403)
    expect(await res.json()).toEqual({ error: 'FORBIDDEN' })
  })

  it('is 401 when signed out', async () => {
    const { algo } = await setup()
    current = null
    const res = await request(algo.id)
    expect(res.status).toBe(401)
    expect(await res.json()).toEqual({ error: 'UNAUTHENTICATED' })
  })
})
