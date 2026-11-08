import { and, desc, eq } from 'drizzle-orm'
import type { Ctx } from '@/server/core/context'
import { requireRole } from '@/server/core/guards'
import { class_, classLecturer, classStudent, course, school } from '@/server/db/schema'

export type LecturerOnboarding = {
  role: 'lecturer'
  steps: { school: boolean; class: boolean; course: boolean; share: boolean }
  /** The last school I added, so "create a class" can open with it picked. */
  latestSchoolId: string | null
  /** My most recent class: where the course goes and whose student code I share. */
  latestClass: { id: string; name: string; studentCode: string } | null
  complete: boolean
}

export type StudentOnboarding = {
  role: 'student'
  steps: { join: boolean }
  complete: boolean
}

export type OnboardingStatus = LecturerOnboarding | StudentOnboarding

/**
 * Where a new user stands on the first-time setup checklist, derived from what they have done
 * (no stored progress). A lecturer has a school once they added one or teach a class at one, and
 * has shared the join code once any student joined one of their classes. Four indexed lookups
 * at most, run in parallel.
 */
export async function getOnboardingStatus(ctx: Ctx): Promise<OnboardingStatus> {
  requireRole(ctx, ctx.user.role)
  const me = ctx.user.id

  if (ctx.user.role === 'student') {
    const [joined] = await ctx.db
      .select({ classId: classStudent.classId })
      .from(classStudent)
      .where(and(eq(classStudent.userId, me), eq(classStudent.status, 'active')))
      .limit(1)
    const join = joined !== undefined
    return { role: 'student', steps: { join }, complete: join }
  }

  const [[latestClass], [latestSchool], [anyCourse], [anyStudent]] = await Promise.all([
    ctx.db
      .select({ id: class_.id, name: class_.name, studentCode: class_.studentCode })
      .from(classLecturer)
      .innerJoin(class_, eq(class_.id, classLecturer.classId))
      .where(eq(classLecturer.userId, me))
      .orderBy(desc(class_.createdAt), desc(class_.id))
      .limit(1),
    ctx.db
      .select({ id: school.id })
      .from(school)
      .where(eq(school.createdBy, me))
      .orderBy(desc(school.createdAt), desc(school.id))
      .limit(1),
    ctx.db.select({ id: course.id }).from(course).where(eq(course.lecturerId, me)).limit(1),
    ctx.db
      .select({ classId: classStudent.classId })
      .from(classStudent)
      .innerJoin(classLecturer, eq(classLecturer.classId, classStudent.classId))
      .where(and(eq(classLecturer.userId, me), eq(classStudent.status, 'active')))
      .limit(1),
  ])

  const steps = {
    school: latestSchool !== undefined || latestClass !== undefined,
    class: latestClass !== undefined,
    course: anyCourse !== undefined,
    share: anyStudent !== undefined,
  }
  return {
    role: 'lecturer',
    steps,
    latestSchoolId: latestSchool?.id ?? null,
    latestClass: latestClass ?? null,
    complete: Object.values(steps).every(Boolean),
  }
}
