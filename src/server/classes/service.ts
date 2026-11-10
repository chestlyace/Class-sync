import { and, asc, count, desc, eq, inArray, isNotNull, isNull, ne, or, sql } from 'drizzle-orm'
import { createElement } from 'react'
import { z } from 'zod'
import { AppError } from '@/server/core/errors'
import type { Ctx } from '@/server/core/context'
import { requireRole } from '@/server/core/guards'
import type { Db } from '@/server/db'
import { class_, classLecturer, classStudent, school, user } from '@/server/db/schema'
import { appLinkBuilder, queueNotifications, type Notification } from '@/server/email/notify'
import { ClassJoinedEmail } from '@/server/email/templates/class-joined'
import { ColleagueJoinedClassEmail, LecturerJoinedClassEmail } from '@/server/email/templates/lecturer-joined-class'
import { emailSubject } from '@/server/email/templates/verify-email'
import { isUniqueViolation } from '@/server/lib/db-errors'
import { getSchool } from '@/server/schools/service'
import {
  generateJoinCode,
  isWellFormedJoinCode,
  normalizeJoinCode,
  normalizeMatricule,
  normalizeOptionalMatricule,
} from './join-code'

export type ClassSummary = {
  id: string
  schoolId: string
  schoolName: string
  name: string
  academicYear: string
  studentCount: number
  /** Present only when the caller is a lecturer of the class. */
  studentCode?: string
  /** Present only when the caller is a lecturer of the class. */
  lecturerCode?: string
  /** Present only when the caller is a student of the class: their matricule, null until they add one. */
  myMatricule?: string | null
}

export type RosterEntry = { studentId: string; name: string; email: string; matricule: string | null }

const MAX_CODE_ATTEMPTS = 5
const STUDENT_CODE_CONSTRAINT = 'class_student_code_unique'
const LECTURER_CODE_CONSTRAINT = 'class_lecturer_code_unique'
const MATRICULE_CONSTRAINT = 'class_student_active_matricule_unique'

const createClassSchema = z.object({
  name: z.string().trim().min(2).max(120),
  academicYear: z
    .string()
    .regex(/^\d{4}\/\d{2}$/)
    .refine((y) => {
      // "2026/27": the second part must be the next year, modulo 100 (so 2099/00 is valid).
      const start = Number(y.slice(0, 4))
      return Number(y.slice(5)) === (start + 1) % 100
    }),
})

function parseCreateInput(input: { name: string; academicYear: string }) {
  const result = createClassSchema.safeParse(input)
  if (!result.success) {
    const fields = [...new Set(result.error.issues.map((i) => i.path.join('.')))]
    throw new AppError('VALIDATION', 'Invalid input', { fields })
  }
  return result.data
}

function isCodeCollision(err: unknown): boolean {
  return isUniqueViolation(err, STUDENT_CODE_CONSTRAINT) || isUniqueViolation(err, LECTURER_CODE_CONSTRAINT)
}

/** True when any class already uses one of `codes` as its student or lecturer code. */
async function codeInUse(db: Db, codes: string[]): Promise<boolean> {
  const [row] = await db
    .select({ id: class_.id })
    .from(class_)
    .where(or(inArray(class_.studentCode, codes), inArray(class_.lecturerCode, codes)))
    .limit(1)
  return row !== undefined
}

export async function isClassLecturer(db: Db, classId: string, userId: string): Promise<boolean> {
  const [row] = await db
    .select({ classId: classLecturer.classId })
    .from(classLecturer)
    .where(and(eq(classLecturer.classId, classId), eq(classLecturer.userId, userId)))
    .limit(1)
  return row !== undefined
}

async function requireClassLecturer(ctx: Ctx, classId: string): Promise<void> {
  requireRole(ctx, 'lecturer')
  // Same error for "no such class" and "not your class": ids are not probed.
  if (!(await isClassLecturer(ctx.db, classId, ctx.user.id))) {
    throw new AppError('FORBIDDEN', 'Only a lecturer of this class can do this')
  }
}

export async function createClass(
  ctx: Ctx,
  input: { schoolId: string; name: string; academicYear: string },
): Promise<ClassSummary> {
  requireRole(ctx, 'lecturer')
  const data = parseCreateInput(input)
  const sch = await getSchool(ctx, input.schoolId)

  for (let attempt = 0; attempt < MAX_CODE_ATTEMPTS; attempt++) {
    const studentCode = generateJoinCode()
    const lecturerCode = generateJoinCode()
    // A student code must never equal a lecturer code anywhere (the unique constraints only
    // guard each column on its own), so check both columns for both values up front.
    if (studentCode === lecturerCode || (await codeInUse(ctx.db, [studentCode, lecturerCode]))) continue
    try {
      const row = await ctx.db.transaction(async (tx) => {
        const [created] = await tx
          .insert(class_)
          .values({
            schoolId: sch.id,
            name: data.name,
            academicYear: data.academicYear,
            studentCode,
            lecturerCode,
            createdBy: ctx.user.id,
          })
          .returning()
        await tx.insert(classLecturer).values({ classId: created.id, userId: ctx.user.id })
        return created
      })
      return {
        id: row.id,
        schoolId: row.schoolId,
        schoolName: sch.name,
        name: row.name,
        academicYear: row.academicYear,
        studentCount: 0,
        studentCode: row.studentCode,
        lecturerCode: row.lecturerCode,
      }
    } catch (err) {
      if (!isCodeCollision(err)) throw err
    }
  }
  throw new Error('Could not generate unique join codes')
}

/** Looks a class up by one of its codes; junk and unknown codes are both NOT_FOUND. */
async function findClassByCode(db: Db, kind: 'student' | 'lecturer', raw: string): Promise<string> {
  const code = normalizeJoinCode(raw)
  if (isWellFormedJoinCode(code)) {
    const column = kind === 'student' ? class_.studentCode : class_.lecturerCode
    const [row] = await db.select({ id: class_.id }).from(class_).where(eq(column, code))
    if (row) return row.id
  }
  throw new AppError('NOT_FOUND', 'Class not found')
}

export type JoinCodePreview =
  /** The code is the other kind (a student opened the lecturer link, or the reverse): no class details. */
  | { status: 'wrong_role'; codeKind: 'student' | 'lecturer' }
  | {
      /** `member`: already in the class (an active student, or one of its lecturers). */
      status: 'ready' | 'member'
      codeKind: 'student' | 'lecturer'
      classId: string
      className: string
      schoolName: string
      academicYear: string
      /** Students only: the matricule they use in another class of the same school, to prefill. */
      suggestedMatricule: string | null
    }

/**
 * What a join link points at, for the signed-in user about to confirm it: the class and school
 * for the right role, only "wrong role" for the other one. Unknown and malformed codes are
 * NOT_FOUND. Joining itself still goes through joinClassAsStudent / joinClassAsLecturer.
 */
export async function previewJoinCode(ctx: Ctx, raw: string): Promise<JoinCodePreview> {
  requireRole(ctx, ctx.user.role) // verified first
  const code = normalizeJoinCode(typeof raw === 'string' ? raw : '')
  if (!isWellFormedJoinCode(code)) throw new AppError('NOT_FOUND', 'Class not found')
  const [row] = await ctx.db
    .select({ cls: class_, schoolName: school.name })
    .from(class_)
    .innerJoin(school, eq(school.id, class_.schoolId))
    .where(or(eq(class_.studentCode, code), eq(class_.lecturerCode, code)))
    .limit(1)
  if (!row) throw new AppError('NOT_FOUND', 'Class not found')
  const codeKind: 'student' | 'lecturer' = row.cls.studentCode === code ? 'student' : 'lecturer'
  if (codeKind !== ctx.user.role) return { status: 'wrong_role', codeKind }

  const details = {
    codeKind,
    classId: row.cls.id,
    className: row.cls.name,
    schoolName: row.schoolName,
    academicYear: row.cls.academicYear,
  }
  if (ctx.user.role === 'lecturer') {
    const member = await isClassLecturer(ctx.db, row.cls.id, ctx.user.id)
    return { status: member ? 'member' : 'ready', ...details, suggestedMatricule: null }
  }
  const mine = await ctx.db
    .select({ classId: classStudent.classId, schoolId: class_.schoolId, matricule: classStudent.matricule })
    .from(classStudent)
    .innerJoin(class_, eq(class_.id, classStudent.classId))
    .where(and(eq(classStudent.userId, ctx.user.id), eq(classStudent.status, 'active')))
    .orderBy(desc(classStudent.joinedAt))
  if (mine.some((m) => m.classId === row.cls.id)) return { status: 'member', ...details, suggestedMatricule: null }
  const sameSchool = mine.find((m) => m.schoolId === row.cls.schoolId && m.matricule !== null)
  return { status: 'ready', ...details, suggestedMatricule: sameSchool?.matricule ?? null }
}

/** The class's and its school's names, for confirmation emails. */
async function classNames(db: Db, classId: string): Promise<{ className: string; schoolName: string }> {
  const [row] = await db
    .select({ className: class_.name, schoolName: school.name })
    .from(class_)
    .innerJoin(school, eq(school.id, class_.schoolId))
    .where(eq(class_.id, classId))
  if (!row) throw new Error(`Class ${classId} not found`)
  return row
}

/**
 * Joins the class as a lecturer. A first join emails, after the response, a confirmation to the
 * joiner and a heads-up to the class's other lecturers and its creator, each in their own
 * language; joining again changes nothing and emails nobody.
 */
export async function joinClassAsLecturer(ctx: Ctx, code: string): Promise<{ classId: string }> {
  requireRole(ctx, 'lecturer') // before the lookup, so a wrong-role caller learns nothing about codes
  const classId = await findClassByCode(ctx.db, 'lecturer', code)
  const inserted = await ctx.db
    .insert(classLecturer)
    .values({ classId, userId: ctx.user.id })
    .onConflictDoNothing()
    .returning({ classId: classLecturer.classId })
  if (inserted.length > 0) {
    await queueNotifications('joinClassAsLecturer', () => lecturerJoinedEmails(ctx, classId))
  }
  return { classId }
}

async function lecturerJoinedEmails(ctx: Ctx, classId: string): Promise<Notification[]> {
  const { className, schoolName } = await classNames(ctx.db, classId)
  const colleagues = await ctx.db
    .selectDistinct({ id: user.id, name: user.name, email: user.email, locale: user.locale })
    .from(user)
    .leftJoin(classLecturer, and(eq(classLecturer.userId, user.id), eq(classLecturer.classId, classId)))
    .leftJoin(class_, and(eq(class_.createdBy, user.id), eq(class_.id, classId)))
    .where(and(or(isNotNull(classLecturer.userId), isNotNull(class_.id)), ne(user.id, ctx.user.id)))
  const url = appLinkBuilder('joinClassAsLecturer')(`/classes/${encodeURIComponent(classId)}`)
  const me = ctx.user
  const items: Notification[] = [
    {
      to: me.email,
      locale: me.locale,
      subject: emailSubject('lecturerJoinedClass', me.locale, { className, schoolName }),
      react: createElement(LecturerJoinedClassEmail, { locale: me.locale, lecturerName: me.name, className, schoolName, url }),
    },
  ]
  for (const c of colleagues) {
    const locale = c.locale === 'fr' ? 'fr' : 'en'
    items.push({
      to: c.email,
      locale,
      subject: emailSubject('colleagueJoinedClass', locale, { colleagueName: me.name, className }),
      react: createElement(ColleagueJoinedClassEmail, {
        locale,
        recipientName: c.name,
        colleagueName: me.name,
        className,
        schoolName,
        url,
      }),
    })
  }
  return items
}

async function studentJoinedEmails(ctx: Ctx, classId: string): Promise<Notification[]> {
  const { className, schoolName } = await classNames(ctx.db, classId)
  const me = ctx.user
  return [
    {
      to: me.email,
      locale: me.locale,
      subject: emailSubject('classJoined', me.locale, { className, schoolName }),
      react: createElement(ClassJoinedEmail, {
        locale: me.locale,
        studentName: me.name,
        className,
        schoolName,
        url: appLinkBuilder('joinClassAsStudent')('/dashboard'),
      }),
    },
  ]
}

/**
 * Joins the class as a student. The matricule is optional (some schools assign them weeks into
 * the year): blank joins without one, to be added later with addMyMatricule. A blank resubmit by
 * an active student keeps the matricule they have.
 */
export async function joinClassAsStudent(
  ctx: Ctx,
  code: string,
  matricule: string,
): Promise<{ classId: string }> {
  requireRole(ctx, 'student')
  const classId = await findClassByCode(ctx.db, 'student', code)
  const normalized = normalizeOptionalMatricule(matricule)
  // Only a join that makes the student active (new, or back after removal) is confirmed by email.
  const [before] = await ctx.db
    .select({ status: classStudent.status })
    .from(classStudent)
    .where(and(eq(classStudent.classId, classId), eq(classStudent.userId, ctx.user.id)))
  const keepMatricule = normalized === null && before?.status === 'active'
  try {
    // An existing row (active or removed) is reactivated with the matricule given now.
    await ctx.db
      .insert(classStudent)
      .values({ classId, userId: ctx.user.id, matricule: normalized, status: 'active' })
      .onConflictDoUpdate({
        target: [classStudent.classId, classStudent.userId],
        set: keepMatricule ? { status: 'active' } : { status: 'active', matricule: normalized },
      })
  } catch (err) {
    if (isUniqueViolation(err, MATRICULE_CONSTRAINT)) {
      throw new AppError('CONFLICT', 'This matricule is already used in this class')
    }
    throw err
  }
  if (before?.status !== 'active') {
    await queueNotifications('joinClassAsStudent', () => studentJoinedEmails(ctx, classId))
  }
  return { classId }
}

/**
 * Adds the matricule a student joined without. Only a missing one can be added this way: a wrong
 * matricule is still fixed by a lecturer removing the student, who then joins again.
 */
export async function addMyMatricule(ctx: Ctx, classId: string, matricule: string): Promise<void> {
  requireRole(ctx, 'student')
  const normalized = normalizeMatricule(matricule)
  const [row] = await ctx.db
    .select({ matricule: classStudent.matricule })
    .from(classStudent)
    .where(
      and(eq(classStudent.classId, classId), eq(classStudent.userId, ctx.user.id), eq(classStudent.status, 'active')),
    )
  if (!row) throw new AppError('NOT_FOUND', 'Class not found')
  if (row.matricule !== null) throw new AppError('FORBIDDEN', 'Your matricule is already set')
  try {
    const updated = await ctx.db
      .update(classStudent)
      .set({ matricule: normalized })
      .where(
        and(
          eq(classStudent.classId, classId),
          eq(classStudent.userId, ctx.user.id),
          eq(classStudent.status, 'active'),
          isNull(classStudent.matricule),
        ),
      )
      .returning({ classId: classStudent.classId })
    // Lost a race with another tab that set it first.
    if (updated.length === 0) throw new AppError('FORBIDDEN', 'Your matricule is already set')
  } catch (err) {
    if (isUniqueViolation(err, MATRICULE_CONSTRAINT)) {
      throw new AppError('CONFLICT', 'This matricule is already used in this class')
    }
    throw err
  }
}

export async function regenerateJoinCode(
  ctx: Ctx,
  classId: string,
  kind: 'student' | 'lecturer',
): Promise<string> {
  await requireClassLecturer(ctx, classId)
  const column = kind === 'student' ? 'studentCode' : 'lecturerCode'
  const constraint = kind === 'student' ? STUDENT_CODE_CONSTRAINT : LECTURER_CODE_CONSTRAINT

  for (let attempt = 0; attempt < MAX_CODE_ATTEMPTS; attempt++) {
    const code = generateJoinCode()
    if (await codeInUse(ctx.db, [code])) continue
    try {
      const updated = await ctx.db
        .update(class_)
        .set({ [column]: code })
        .where(eq(class_.id, classId))
        .returning({ id: class_.id })
      if (updated.length === 0) throw new AppError('NOT_FOUND', 'Class not found')
      return code
    } catch (err) {
      if (!isUniqueViolation(err, constraint)) throw err
    }
  }
  throw new Error('Could not generate a unique join code')
}

export async function removeStudentFromClass(ctx: Ctx, classId: string, studentId: string): Promise<void> {
  await requireClassLecturer(ctx, classId)
  const updated = await ctx.db
    .update(classStudent)
    .set({ status: 'removed' })
    .where(and(eq(classStudent.classId, classId), eq(classStudent.userId, studentId)))
    .returning({ userId: classStudent.userId })
  if (updated.length === 0) throw new AppError('NOT_FOUND', 'Student not found in this class')
}

export async function listMyClasses(ctx: Ctx): Promise<ClassSummary[]> {
  const isLecturer = ctx.user.role === 'lecturer'
  requireRole(ctx, ctx.user.role)

  const selection = { cls: class_, schoolName: school.name }
  const rows: { cls: typeof class_.$inferSelect; schoolName: string; matricule?: string | null }[] = isLecturer
    ? await ctx.db
        .select(selection)
        .from(classLecturer)
        .innerJoin(class_, eq(class_.id, classLecturer.classId))
        .innerJoin(school, eq(school.id, class_.schoolId))
        .where(eq(classLecturer.userId, ctx.user.id))
        .orderBy(asc(school.name), asc(class_.name), asc(class_.id))
    : await ctx.db
        .select({ ...selection, matricule: classStudent.matricule })
        .from(classStudent)
        .innerJoin(class_, eq(class_.id, classStudent.classId))
        .innerJoin(school, eq(school.id, class_.schoolId))
        .where(and(eq(classStudent.userId, ctx.user.id), eq(classStudent.status, 'active')))
        .orderBy(asc(school.name), asc(class_.name), asc(class_.id))
  if (rows.length === 0) return []

  const counts = await ctx.db
    .select({ classId: classStudent.classId, n: count() })
    .from(classStudent)
    .where(
      and(
        inArray(
          classStudent.classId,
          rows.map((r) => r.cls.id),
        ),
        eq(classStudent.status, 'active'),
      ),
    )
    .groupBy(classStudent.classId)
  const countByClass = new Map(counts.map((c) => [c.classId, Number(c.n)]))

  return rows.map(({ cls, schoolName, matricule }) => ({
    id: cls.id,
    schoolId: cls.schoolId,
    schoolName,
    name: cls.name,
    academicYear: cls.academicYear,
    studentCount: countByClass.get(cls.id) ?? 0,
    ...(isLecturer ? { studentCode: cls.studentCode, lecturerCode: cls.lecturerCode } : { myMatricule: matricule }),
  }))
}

export async function getClassRoster(ctx: Ctx, classId: string): Promise<RosterEntry[]> {
  await requireClassLecturer(ctx, classId)
  return ctx.db
    .select({
      studentId: user.id,
      name: user.name,
      email: user.email,
      matricule: classStudent.matricule,
    })
    .from(classStudent)
    .innerJoin(user, eq(user.id, classStudent.userId))
    .where(and(eq(classStudent.classId, classId), eq(classStudent.status, 'active')))
    .orderBy(asc(sql`lower(${user.name})`), asc(classStudent.matricule), asc(user.id))
}
