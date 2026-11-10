import { and, asc, eq, sql } from 'drizzle-orm'
import type { SQL } from 'drizzle-orm'
import type { Db } from '@/server/db'
import { class_, classStudent, course, courseRosterAdjustment, user } from '@/server/db/schema'

export type RosterSource = 'class' | 'included'

export type CourseRosterRow = {
  courseId: string
  studentId: string
  name: string
  email: string
  /** Null when the student has no matricule at the school yet. */
  matricule: string | null
  source: RosterSource
}

/**
 * THE roster rule. A student is on a course's roster when
 *   (active in the course's class AND not excluded)  OR  (included AND active in some class
 *   at the course's school).
 * Every roster read (a course's roster, one student's membership, a student's course list) goes
 * through `courseRosterQuery`, so this is the only place the rule is written down.
 *
 * Callers pass `courseId`, `studentId`, or both; the result is always every roster row matching.
 */
export async function courseRosterQuery(
  db: Db,
  filter: { courseId?: string; studentId?: string },
): Promise<CourseRosterRow[]> {
  // The roster rule is written once, as the correlated predicates below (one per clause).
  const inClass = sql`exists (
    select 1 from ${classStudent} as own_cs
    where own_cs.class_id = ${course.classId} and own_cs.user_id = ${user.id} and own_cs.status = 'active'
  )`
  const adjustment = (kind: 'include' | 'exclude') => sql`exists (
    select 1 from ${courseRosterAdjustment} as adj
    where adj.course_id = ${course.id} and adj.student_id = ${user.id} and adj.kind = ${kind}
  )`
  // Active membership in any class at the course's school; joined to the course's own class's school.
  const schoolMembership = sql`from ${classStudent} as sch_cs
    inner join ${class_} as sch_class on sch_class.id = sch_cs.class_id
    where sch_cs.user_id = ${user.id} and sch_cs.status = 'active' and sch_class.school_id = ${class_.schoolId}`
  const activeAtSchool = sql`exists (select 1 ${schoolMembership})`

  const onRoster: SQL = sql`((${inClass} and not ${adjustment('exclude')}) or (${adjustment('include')} and ${activeAtSchool}))`

  // Own-class matricule when the student has one there; otherwise the one from their most recent
  // active membership at the school that has one (ties broken by class id so the pick is
  // deterministic). Null when they have none at the school yet.
  const matricule = sql<string | null>`coalesce(
    (select own_cs.matricule from ${classStudent} as own_cs
      where own_cs.class_id = ${course.classId} and own_cs.user_id = ${user.id} and own_cs.status = 'active'),
    (select sch_cs.matricule ${schoolMembership} and sch_cs.matricule is not null
      order by sch_cs.joined_at desc, sch_cs.class_id limit 1)
  )`
  const source = sql<RosterSource>`case when ${inClass} then 'class' else 'included' end`

  const conditions: SQL[] = [eq(user.role, 'student'), onRoster]
  if (filter.courseId !== undefined) conditions.push(eq(course.id, filter.courseId))
  if (filter.studentId !== undefined) conditions.push(eq(user.id, filter.studentId))

  return db
    .select({
      courseId: course.id,
      studentId: user.id,
      name: user.name,
      email: user.email,
      matricule: matricule.as('matricule'),
      source: source.as('source'),
    })
    .from(course)
    .innerJoin(class_, eq(class_.id, course.classId))
    // Candidates: the class's active students plus anyone with an include row. `onRoster` decides.
    .innerJoin(
      user,
      sql`${user.id} in (
        select cs.user_id from ${classStudent} as cs where cs.class_id = ${course.classId} and cs.status = 'active'
        union
        select a.student_id from ${courseRosterAdjustment} as a where a.course_id = ${course.id} and a.kind = 'include'
      )`,
    )
    .where(and(...conditions))
    .orderBy(asc(sql`lower(${user.name})`), asc(sql`matricule`), asc(user.id))
}

export async function isOnCourseRoster(db: Db, courseId: string, studentId: string): Promise<boolean> {
  const rows = await courseRosterQuery(db, { courseId, studentId })
  return rows.length > 0
}

/** Ids of the courses a student is on the roster of. */
export async function rosteredCourseIds(db: Db, studentId: string): Promise<string[]> {
  const rows = await courseRosterQuery(db, { studentId })
  return rows.map((r) => r.courseId)
}

