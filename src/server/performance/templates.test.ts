import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import type { Db } from '@/server/db'
import { caTemplate, class_, classLecturer, course, school, user } from '@/server/db/schema'
import { createClass } from '@/server/classes/service'
import { createCourse } from '@/server/courses/service'
import { createSchool } from '@/server/schools/service'
import { createTest } from '@/server/tests/authoring'
import { createTestDb } from '@/test/db'
import { ctxFor, makeUser } from '@/test/factories'
import { getCaSettings } from './inputs'
import { DEFAULT_SETTINGS, type CaSettings } from './rules'
import { updateCaSettings } from './settings'
import {
  applyCaTemplate,
  createCaTemplate,
  deleteCaTemplate,
  listCaTemplates,
  setDefaultCaTemplate,
} from './templates'

vi.mock('@/server/push/send', () => ({
  sendPush: vi.fn(async () => ({ sent: 0, skipped: 0, failed: 0, removed: 0 })),
  queuePush: vi.fn(async () => {}),
}))

const MINE: CaSettings = {
  ...DEFAULT_SETTINGS,
  total: 20,
  attendancePoints: 4,
  assignmentPoints: 4,
  participationPoints: 0,
  testPoints: 12,
  groups: [
    { id: null, name: 'Midterm', points: 8, bestOf: null },
    { id: null, name: 'Quizzes', points: 4, bestOf: 2 },
  ],
}

/** Settings without the named CAs' ids, to compare across courses. */
const shape = (s: CaSettings) => ({ ...s, groups: s.groups.map(({ name, points, bestOf }) => ({ name, points, bestOf })) })

describe('CA templates', () => {
  let db: Db

  beforeAll(async () => {
    db = await createTestDb()
  })
  afterEach(async () => {
    await db.delete(course)
    await db.delete(classLecturer)
    await db.delete(class_)
    await db.delete(school)
    await db.delete(caTemplate)
    await db.delete(user)
  })

  async function setup(locale: 'en' | 'fr' = 'en') {
    const lecturer = ctxFor(db, await makeUser(db, { role: 'lecturer', locale }))
    const sch = await createSchool(lecturer, { name: `School ${crypto.randomUUID()}`, town: 'Buea' })
    const cls = await createClass(lecturer, { schoolId: sch.id, name: 'CS L3', academicYear: '2026/27' })
    const algo = await createCourse(lecturer, { classId: cls.id, title: 'Algorithms', semester: 1 })
    const nets = await createCourse(lecturer, { classId: cls.id, title: 'Networks', semester: 1 })
    return { lecturer, cls, algo, nets }
  }

  it('saves my template, lists it, and refuses a name I already use (case ignored)', async () => {
    const { lecturer } = await setup()
    const created = await createCaTemplate(lecturer, { name: '  My L3 courses ', settings: MINE })
    expect(created.name).toBe('My L3 courses')
    const { templates, defaultTemplate } = await listCaTemplates(lecturer)
    expect(templates).toEqual([{ id: created.id, name: 'My L3 courses', settings: MINE }])
    expect(defaultTemplate).toBeNull()

    await expect(createCaTemplate(lecturer, { name: 'my l3 COURSES', settings: MINE })).rejects.toMatchObject({
      code: 'CONFLICT',
      details: { reason: 'name_taken' },
    })
    await expect(createCaTemplate(lecturer, { name: '   ', settings: MINE })).rejects.toMatchObject({
      code: 'VALIDATION',
      details: { fields: ['name'] },
    })
    await expect(
      createCaTemplate(lecturer, { name: 'Wrong sum', settings: { ...MINE, total: 30 } }),
    ).rejects.toMatchObject({ code: 'VALIDATION', details: { reason: 'sum' } })
  })

  it("another lecturer's template is out of reach, and students have none", async () => {
    const { lecturer } = await setup()
    const created = await createCaTemplate(lecturer, { name: 'Mine', settings: MINE })
    const other = await setup()
    await expect(deleteCaTemplate(other.lecturer, created.id)).rejects.toMatchObject({ code: 'NOT_FOUND' })
    await expect(applyCaTemplate(other.lecturer, { templateId: created.id }, [other.algo.id])).rejects.toMatchObject({
      code: 'NOT_FOUND',
    })
    expect((await listCaTemplates(other.lecturer)).templates).toEqual([])
    const student = ctxFor(db, await makeUser(db, { role: 'student' }))
    await expect(listCaTemplates(student)).rejects.toMatchObject({ code: 'FORBIDDEN' })
  })

  it('applies my template to several courses at once', async () => {
    const { lecturer, algo, nets } = await setup()
    const created = await createCaTemplate(lecturer, { name: 'Mine', settings: MINE })
    expect(await applyCaTemplate(lecturer, { templateId: created.id }, [algo.id, nets.id, algo.id])).toBe(2)
    for (const id of [algo.id, nets.id]) {
      const settings = await getCaSettings(db, id)
      expect(shape(settings)).toEqual(shape(MINE))
      expect(settings.groups.every((g) => typeof g.id === 'string')).toBe(true)
    }
  })

  it("applies a built-in template, its CAs named in the lecturer's language", async () => {
    const { lecturer, algo } = await setup('fr')
    await applyCaTemplate(lecturer, { builtInId: 'twoCas' }, [algo.id])
    const settings = await getCaSettings(db, algo.id)
    expect(settings).toMatchObject({ total: 30, attendancePoints: 5, assignmentPoints: 5, testPoints: 20 })
    expect(settings.groups.map((g) => [g.name, g.points])).toEqual([
      ['CC 1', 10],
      ['CC 2', 10],
    ])
  })

  it('keeps a named CA (and its tests) when the template has one with the same name', async () => {
    const { lecturer, algo } = await setup()
    const before = await updateCaSettings(lecturer, algo.id, {
      ...DEFAULT_SETTINGS,
      assignmentPoints: 10,
      groups: [{ id: null, name: 'CA 2', points: 10, bestOf: null }],
    })
    const ca2 = before.groups[0].id
    const test = await createTest(lecturer, algo.id, {
      title: 'Quiz',
      durationMinutes: 10,
      defaultMark: 1,
      shuffle: false,
      maxExits: 3,
      maxAbsenceSeconds: 10,
      caGroupId: ca2,
      questions: [{ kind: 'mcq', prompt: 'Q', mark: null, options: [{ text: 'A', correct: true }, { text: 'B', correct: false }] }],
    })
    expect(test.caGroupId).toBe(ca2)

    await applyCaTemplate(lecturer, { builtInId: 'twoCas' }, [algo.id])
    const after = await getCaSettings(db, algo.id)
    expect(after.groups.map((g) => g.name)).toEqual(['CA 1', 'CA 2'])
    expect(after.groups[1].id).toBe(ca2)
  })

  it('refuses the whole apply when one course is not mine, before writing anything', async () => {
    const { lecturer, algo } = await setup()
    const other = await setup()
    await expect(applyCaTemplate(lecturer, { builtInId: 'testsOnly' }, [algo.id, other.algo.id])).rejects.toMatchObject({
      code: 'FORBIDDEN',
    })
    expect(await getCaSettings(db, algo.id)).toEqual(DEFAULT_SETTINGS)
    await expect(applyCaTemplate(lecturer, { builtInId: 'testsOnly' }, [])).rejects.toMatchObject({ code: 'VALIDATION' })
    await expect(applyCaTemplate(lecturer, { builtInId: 'nope' }, [algo.id])).rejects.toMatchObject({ code: 'VALIDATION' })
  })

  it('new courses start with my default template; existing ones do not change', async () => {
    const { lecturer, cls, algo } = await setup()
    const created = await createCaTemplate(lecturer, { name: 'Mine', settings: MINE })
    expect(await setDefaultCaTemplate(lecturer, { templateId: created.id })).toEqual({ templateId: created.id })
    expect((await listCaTemplates(lecturer)).defaultTemplate).toEqual({ templateId: created.id })

    const fresh = await createCourse(lecturer, { classId: cls.id, title: 'Compilers', semester: 2 })
    expect(shape(await getCaSettings(db, fresh.id))).toEqual(shape(MINE))
    expect(await getCaSettings(db, algo.id)).toEqual(DEFAULT_SETTINGS)

    // A built-in default works the same way.
    await setDefaultCaTemplate(lecturer, { builtInId: 'balanced' })
    const balanced = await createCourse(lecturer, { classId: cls.id, title: 'Databases', semester: 2 })
    expect(await getCaSettings(db, balanced.id)).toMatchObject({ testPoints: 10, assignmentPoints: 10, groups: [] })

    // Back to the app's defaults.
    expect(await setDefaultCaTemplate(lecturer, null)).toBeNull()
    const plain = await createCourse(lecturer, { classId: cls.id, title: 'Security', semester: 2 })
    expect(await getCaSettings(db, plain.id)).toEqual(DEFAULT_SETTINGS)
  })

  it('deleting my default template sends new courses back to the app defaults', async () => {
    const { lecturer, cls } = await setup()
    const created = await createCaTemplate(lecturer, { name: 'Mine', settings: MINE })
    await setDefaultCaTemplate(lecturer, { templateId: created.id })
    await deleteCaTemplate(lecturer, created.id)
    expect(await listCaTemplates(lecturer)).toEqual({ templates: [], defaultTemplate: null })
    const fresh = await createCourse(lecturer, { classId: cls.id, title: 'Compilers', semester: 2 })
    expect(await getCaSettings(db, fresh.id)).toEqual(DEFAULT_SETTINGS)
  })
})
