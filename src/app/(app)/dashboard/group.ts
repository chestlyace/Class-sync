import type { ClassSummary } from '@/server/classes/service'
import type { CourseSummary } from '@/server/courses/service'

export type ClassGroup = { cls: ClassSummary; courses: CourseSummary[] }
export type SchoolGroup = { schoolId: string; schoolName: string; classes: ClassGroup[] }

/**
 * Lays the dashboard out: my classes grouped by school (in the order they arrive: school, then
 * class name), each with its courses. A course whose class is not one of mine (a student included
 * in a course of another class at the school) goes to `otherCourses` instead of being dropped.
 */
export function groupDashboard(
  classes: ClassSummary[],
  courses: CourseSummary[],
): { schools: SchoolGroup[]; otherCourses: CourseSummary[] } {
  const byClass = new Map<string, ClassGroup>()
  const schools = new Map<string, SchoolGroup>()
  for (const cls of classes) {
    const entry: ClassGroup = { cls, courses: [] }
    byClass.set(cls.id, entry)
    const school = schools.get(cls.schoolId) ?? { schoolId: cls.schoolId, schoolName: cls.schoolName, classes: [] }
    school.classes.push(entry)
    schools.set(cls.schoolId, school)
  }
  const otherCourses: CourseSummary[] = []
  for (const course of courses) {
    const entry = byClass.get(course.classId)
    if (entry) entry.courses.push(course)
    else otherCourses.push(course)
  }
  return { schools: [...schools.values()], otherCourses }
}
