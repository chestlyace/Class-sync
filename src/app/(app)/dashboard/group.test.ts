import { describe, expect, it } from 'vitest'
import type { ClassSummary } from '@/server/classes/service'
import type { CourseSummary } from '@/server/courses/service'
import { groupDashboard } from './group'

function cls(id: string, schoolId: string): ClassSummary {
  return { id, schoolId, schoolName: `School ${schoolId}`, name: `Class ${id}`, academicYear: '2026/27', studentCount: 1 }
}

function course(id: string, classId: string): CourseSummary {
  return {
    id,
    title: `Course ${id}`,
    code: null,
    semester: 1,
    classId,
    className: `Class ${classId}`,
    schoolId: 's1',
    schoolName: 'School s1',
    lecturerName: 'Dr X',
  }
}

describe('groupDashboard', () => {
  it('groups classes by school, keeping order, and puts each course under its class', () => {
    const { schools, otherCourses } = groupDashboard(
      [cls('c1', 's1'), cls('c2', 's1'), cls('c3', 's2')],
      [course('k1', 'c1'), course('k2', 'c3'), course('k3', 'c1')],
    )
    expect(schools.map((s) => [s.schoolId, s.classes.map((c) => [c.cls.id, c.courses.map((k) => k.id)])])).toEqual([
      ['s1', [['c1', ['k1', 'k3']], ['c2', []]]],
      ['s2', [['c3', ['k2']]]],
    ])
    expect(otherCourses).toEqual([])
  })

  it('keeps courses whose class is not one of mine (included carry-over courses) as "other courses"', () => {
    const { schools, otherCourses } = groupDashboard(
      [cls('c2', 's1')],
      [course('k1', 'c1'), course('k2', 'c2'), course('k3', 'c9')],
    )
    expect(schools[0].classes[0].courses.map((k) => k.id)).toEqual(['k2'])
    expect(otherCourses.map((k) => k.id)).toEqual(['k1', 'k3'])
  })

  it('still returns other courses when I am in no class', () => {
    const { schools, otherCourses } = groupDashboard([], [course('k1', 'c1')])
    expect(schools).toEqual([])
    expect(otherCourses.map((k) => k.id)).toEqual(['k1'])
  })
})
