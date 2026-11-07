import { afterEach, beforeAll, describe, expect, it } from 'vitest'
import { config, setConfigForTests } from '@/server/core/config'
import type { Db } from '@/server/db'
import { class_, classLecturer, school } from '@/server/db/schema'
import { createTestDb } from '@/test/db'
import { ctxFor, makeUser } from '@/test/factories'
import { createSchool, getSchool, searchSchools, setSchoolLocation } from './service'

describe('schools service', () => {
  let db: Db
  const original = config.requireEmailVerification

  // One PGlite per file (booting + migrating is slow); wipe the school tables between tests.
  beforeAll(async () => {
    db = await createTestDb()
  })
  afterEach(async () => {
    setConfigForTests({ requireEmailVerification: original })
    await db.delete(classLecturer)
    await db.delete(class_)
    await db.delete(school)
  })

  async function lecturerCtx(overrides = {}) {
    return ctxFor(db, await makeUser(db, { role: 'lecturer', ...overrides }))
  }

  it('lecturer creates a school with default radius 500', async () => {
    const ctx = await lecturerCtx()
    const school = await createSchool(ctx, { name: '  University of Buea ', town: 'Buea' })
    expect(school).toEqual({
      id: expect.any(String),
      name: 'University of Buea',
      town: 'Buea',
      latitude: null,
      longitude: null,
      radiusM: 500,
    })
  })

  it('creates a school with no coordinates (both absent)', async () => {
    const ctx = await lecturerCtx()
    const school = await createSchool(ctx, { name: 'UB', town: 'Buea' })
    expect(school).toMatchObject({ latitude: null, longitude: null })
  })

  it('reports the missing coordinate field in VALIDATION details', async () => {
    const ctx = await lecturerCtx()
    await expect(
      createSchool(ctx, { name: 'UB', town: 'Buea', latitude: 4.15 }),
    ).rejects.toMatchObject({ code: 'VALIDATION', details: { fields: ['longitude'] } })
  })

  it('stores optional location and radius', async () => {
    const ctx = await lecturerCtx()
    const school = await createSchool(ctx, {
      name: 'UB',
      town: 'Buea',
      latitude: 4.15,
      longitude: 9.29,
      radiusM: 800,
    })
    expect(school).toMatchObject({ latitude: 4.15, longitude: 9.29, radiusM: 800 })
  })

  it('student cannot create a school', async () => {
    const ctx = ctxFor(db, await makeUser(db, { role: 'student' }))
    await expect(createSchool(ctx, { name: 'UB', town: 'Buea' })).rejects.toMatchObject({
      code: 'FORBIDDEN',
    })
  })

  it('unverified lecturer cannot create when verification is required', async () => {
    setConfigForTests({ requireEmailVerification: true })
    const ctx = await lecturerCtx({ emailVerified: false })
    await expect(createSchool(ctx, { name: 'UB', town: 'Buea' })).rejects.toMatchObject({
      code: 'EMAIL_UNVERIFIED',
    })
  })

  it('duplicate name in same town returns CONFLICT with existingSchoolId', async () => {
    const ctx = await lecturerCtx()
    const first = await createSchool(ctx, { name: 'University of Buea', town: 'Buea' })
    await expect(
      createSchool(ctx, { name: '  university of  buea ', town: 'BUEA' }),
    ).rejects.toMatchObject({
      code: 'CONFLICT',
      details: { existingSchoolId: first.id },
    })
  })

  it('a name differing only by accents in the same town is CONFLICT', async () => {
    const ctx = await lecturerCtx()
    const first = await createSchool(ctx, { name: 'Université de Buea', town: 'Buéa' })
    await expect(createSchool(ctx, { name: 'Universite de Buea', town: 'Buea' })).rejects.toMatchObject({
      code: 'CONFLICT',
      details: { existingSchoolId: first.id },
    })
  })

  it('same name in a different town is allowed', async () => {
    const ctx = await lecturerCtx()
    const a = await createSchool(ctx, { name: 'Government High School', town: 'Buea' })
    const b = await createSchool(ctx, { name: 'Government High School', town: 'Limbe' })
    expect(a.id).not.toBe(b.id)
  })

  it.each([
    ['name too short', { name: 'A', town: 'Buea' }],
    ['name blank after trim', { name: '    ', town: 'Buea' }],
    ['name too long', { name: 'x'.repeat(121), town: 'Buea' }],
    ['town too short', { name: 'UB', town: ' B ' }],
    ['latitude out of range', { name: 'UB', town: 'Buea', latitude: 91, longitude: 0 }],
    ['longitude out of range', { name: 'UB', town: 'Buea', latitude: 0, longitude: -181 }],
    ['radius too small', { name: 'UB', town: 'Buea', radiusM: 49 }],
    ['radius too large', { name: 'UB', town: 'Buea', radiusM: 5001 }],
    ['radius not an integer', { name: 'UB', town: 'Buea', radiusM: 100.5 }],
    ['latitude without longitude', { name: 'UB', town: 'Buea', latitude: 4.15 }],
    ['longitude without latitude', { name: 'UB', town: 'Buea', longitude: 9.29 }],
    ['latitude is NaN', { name: 'UB', town: 'Buea', latitude: NaN, longitude: 0 }],
  ])('rejects invalid input: %s', async (_label, input) => {
    const ctx = await lecturerCtx()
    await expect(createSchool(ctx, input)).rejects.toMatchObject({ code: 'VALIDATION' })
  })

  describe('searchSchools', () => {
    it('matches case-insensitively and orders by name', async () => {
      const ctx = await lecturerCtx()
      await createSchool(ctx, { name: 'Zeta Institute', town: 'Buea' })
      await createSchool(ctx, { name: 'alpha INSTITUTE', town: 'Buea' })
      await createSchool(ctx, { name: 'Other College', town: 'Buea' })
      const found = await searchSchools(ctx, 'institute')
      expect(found.map((s) => s.name)).toEqual(['alpha INSTITUTE', 'Zeta Institute'])
    })

    it('ignores accents in both directions', async () => {
      const ctx = await lecturerCtx()
      await createSchool(ctx, { name: 'Université de Buea', town: 'Buea' })
      await createSchool(ctx, { name: 'Ecole Normale', town: 'Yaounde' })
      expect((await searchSchools(ctx, 'Universite de Buea')).map((s) => s.name)).toEqual(['Université de Buea'])
      expect((await searchSchools(ctx, '  UNIVERSITÉ   de ')).map((s) => s.name)).toEqual(['Université de Buea'])
      expect((await searchSchools(ctx, 'école')).map((s) => s.name)).toEqual(['Ecole Normale'])
    })

    it('caps results at 20', async () => {
      const ctx = await lecturerCtx()
      for (let i = 0; i < 25; i++) {
        await createSchool(ctx, { name: `Test School ${String(i).padStart(2, '0')}`, town: 'Buea' })
      }
      const found = await searchSchools(ctx, 'test school')
      expect(found).toHaveLength(20)
      expect(found[0].name).toBe('Test School 00')
    })

    it('returns [] for an empty or blank query', async () => {
      const ctx = await lecturerCtx()
      await createSchool(ctx, { name: 'UB', town: 'Buea' })
      expect(await searchSchools(ctx, '')).toEqual([])
      expect(await searchSchools(ctx, '   ')).toEqual([])
    })

    it('treats % and _ literally rather than as wildcards', async () => {
      const ctx = await lecturerCtx()
      await createSchool(ctx, { name: '100% School', town: 'Buea' })
      await createSchool(ctx, { name: 'Snake_case Academy', town: 'Buea' })
      await createSchool(ctx, { name: 'Plain Academy', town: 'Buea' })
      expect((await searchSchools(ctx, '%')).map((s) => s.name)).toEqual(['100% School'])
      expect((await searchSchools(ctx, '_')).map((s) => s.name)).toEqual(['Snake_case Academy'])
      expect(await searchSchools(ctx, 'a_demy')).toEqual([])
    })

    it('is available to verified students, but not unverified users', async () => {
      const lecturer = await lecturerCtx()
      await createSchool(lecturer, { name: 'UB', town: 'Buea' })
      const student = ctxFor(db, await makeUser(db, { role: 'student' }))
      expect(await searchSchools(student, 'ub')).toHaveLength(1)

      setConfigForTests({ requireEmailVerification: true })
      const unverified = ctxFor(db, await makeUser(db, { role: 'student', emailVerified: false }))
      await expect(searchSchools(unverified, 'ub')).rejects.toMatchObject({
        code: 'EMAIL_UNVERIFIED',
      })
    })
  })

  describe('getSchool', () => {
    it('returns the school', async () => {
      const ctx = await lecturerCtx()
      const created = await createSchool(ctx, { name: 'UB', town: 'Buea' })
      expect(await getSchool(ctx, created.id)).toEqual(created)
    })

    it('throws NOT_FOUND for a missing school', async () => {
      const ctx = await lecturerCtx()
      await expect(getSchool(ctx, 'nope')).rejects.toMatchObject({ code: 'NOT_FOUND' })
    })
  })

  describe('setSchoolLocation', () => {
    it('creator can set the location; radius is kept when omitted', async () => {
      const ctx = await lecturerCtx()
      const created = await createSchool(ctx, { name: 'UB', town: 'Buea', radiusM: 700 })
      const updated = await setSchoolLocation(ctx, created.id, { latitude: 4.15, longitude: 9.29 })
      expect(updated).toMatchObject({ id: created.id, latitude: 4.15, longitude: 9.29, radiusM: 700 })
      expect(await getSchool(ctx, created.id)).toEqual(updated)
    })

    it('updates the radius when given', async () => {
      const ctx = await lecturerCtx()
      const created = await createSchool(ctx, { name: 'UB', town: 'Buea' })
      const updated = await setSchoolLocation(ctx, created.id, {
        latitude: 1,
        longitude: 2,
        radiusM: 1200,
      })
      expect(updated.radiusM).toBe(1200)
    })

    it('a lecturer of a class at that school can set the location', async () => {
      const creator = await lecturerCtx()
      const school = await createSchool(creator, { name: 'UB', town: 'Buea' })
      const other = await lecturerCtx()
      const [cls] = await db
        .insert(class_)
        .values({
          schoolId: school.id,
          name: 'CS 101',
          academicYear: '2026/27',
          studentCode: 'STU-AAAA',
          lecturerCode: 'LEC-AAAA',
          createdBy: creator.user.id,
        })
        .returning()
      await db.insert(classLecturer).values({ classId: cls.id, userId: other.user.id })

      const updated = await setSchoolLocation(other, school.id, { latitude: 3, longitude: 4 })
      expect(updated).toMatchObject({ latitude: 3, longitude: 4 })
    })

    it('an unrelated lecturer is FORBIDDEN', async () => {
      const creator = await lecturerCtx()
      const school = await createSchool(creator, { name: 'UB', town: 'Buea' })
      const stranger = await lecturerCtx()
      await expect(
        setSchoolLocation(stranger, school.id, { latitude: 3, longitude: 4 }),
      ).rejects.toMatchObject({ code: 'FORBIDDEN' })
    })

    it('a lecturer of a class at a different school is FORBIDDEN', async () => {
      const creator = await lecturerCtx()
      const school = await createSchool(creator, { name: 'UB', town: 'Buea' })
      const otherSchool = await createSchool(creator, { name: 'UY1', town: 'Yaounde' })
      const other = await lecturerCtx()
      const [cls] = await db
        .insert(class_)
        .values({
          schoolId: otherSchool.id,
          name: 'CS 101',
          academicYear: '2026/27',
          studentCode: 'STU-BBBB',
          lecturerCode: 'LEC-BBBB',
          createdBy: creator.user.id,
        })
        .returning()
      await db.insert(classLecturer).values({ classId: cls.id, userId: other.user.id })
      await expect(
        setSchoolLocation(other, school.id, { latitude: 3, longitude: 4 }),
      ).rejects.toMatchObject({ code: 'FORBIDDEN' })
    })

    it('a student is FORBIDDEN', async () => {
      const creator = await lecturerCtx()
      const school = await createSchool(creator, { name: 'UB', town: 'Buea' })
      const student = ctxFor(db, await makeUser(db, { role: 'student' }))
      await expect(
        setSchoolLocation(student, school.id, { latitude: 3, longitude: 4 }),
      ).rejects.toMatchObject({ code: 'FORBIDDEN' })
    })

    it('throws NOT_FOUND for a missing school', async () => {
      const ctx = await lecturerCtx()
      await expect(
        setSchoolLocation(ctx, 'nope', { latitude: 3, longitude: 4 }),
      ).rejects.toMatchObject({ code: 'NOT_FOUND' })
    })

    it('rejects out-of-range coordinates with VALIDATION', async () => {
      const ctx = await lecturerCtx()
      const school = await createSchool(ctx, { name: 'UB', town: 'Buea' })
      await expect(
        setSchoolLocation(ctx, school.id, { latitude: 100, longitude: 0 }),
      ).rejects.toMatchObject({ code: 'VALIDATION' })
      await expect(
        setSchoolLocation(ctx, school.id, { latitude: 0, longitude: 0, radiusM: 10 }),
      ).rejects.toMatchObject({ code: 'VALIDATION' })
    })
  })
})
