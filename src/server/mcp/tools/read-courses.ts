import { z } from 'zod'
import { getAttendanceGrid } from '@/server/attendance/reports'
import { getCourseRoster, listLecturerCourses, requireCourseOwner } from '@/server/courses/service'
import { attendanceRatio } from '@/server/performance/compute'
import { getCaSettings, getCourseCa } from '@/server/performance/service'
import { defineTool } from '../tool'
import { id, iso, round } from './read-shared'

const courseId = id('The course id, from list_courses.')

export const listCourses = defineTool({
  name: 'list_courses',
  title: 'List my courses',
  description:
    "The lecturer's courses, each with its id, title, code, semester, class, school and number of students on the roster. " +
    'Start here: the course ids it returns are what the other tools need.',
  scope: 'clasync:read',
  input: z.object({}),
  run: async (ctx) => {
    const courses = await listLecturerCourses(ctx)
    const sizes = await Promise.all(courses.map((c) => getCourseRoster(ctx, c.id).then((r) => r.length)))
    return {
      courses: courses.map((c, i) => ({
        id: c.id,
        title: c.title,
        code: c.code,
        semester: c.semester,
        class: { id: c.classId, name: c.className },
        school: { id: c.schoolId, name: c.schoolName },
        students: sizes[i],
      })),
    }
  },
})

export const getCourseTool = defineTool({
  name: 'get_course',
  title: 'Get a course',
  description:
    'One course: its details, the roster (student id, name, matricule; `source` is "included" for a student added from ' +
    'another class) and its CA settings (points per part, total, participation target, best-of for tests). Needs courseId from list_courses.',
  scope: 'clasync:read',
  input: z.object({ courseId }),
  run: async (ctx, { courseId }) => {
    const course = await requireCourseOwner(ctx, courseId)
    const [roster, settings] = await Promise.all([getCourseRoster(ctx, courseId), getCaSettings(ctx.db, courseId)])
    return {
      id: course.id,
      title: course.title,
      code: course.code,
      semester: course.semester,
      class: { id: course.classId, name: course.className },
      school: { id: course.schoolId, name: course.schoolName },
      caSettings: settings,
      roster: roster.map((s) => ({ studentId: s.studentId, name: s.name, matricule: s.matricule, source: s.source })),
    }
  },
})

export const getAttendance = defineTool({
  name: 'get_attendance',
  title: 'Get attendance',
  description:
    "A course's attendance: the sessions (oldest first, with their date) and, per student on the roster, a status for each " +
    'session in the same order (present, partial, absent, not_enrolled, or null when no check-in window was opened), ' +
    'the totals and the attendance rate from 0 to 1 ((present + half the partials) / counted sessions; null before any counts). ' +
    '`overridden` lists the session ids where the lecturer set the status by hand. Needs courseId from list_courses.',
  scope: 'clasync:read',
  input: z.object({ courseId }),
  run: async (ctx, { courseId }) => {
    const grid = await getAttendanceGrid(ctx, courseId)
    return {
      sessions: grid.sessions.map((s) => ({
        id: s.id,
        date: iso(s.createdAt),
        requireOnCampus: s.requireOnCampus,
        windowsOpened: s.windowsOpened,
      })),
      students: grid.rows.map((r) => {
        const overridden = grid.sessions.filter((s) => r.overridden[s.id]).map((s) => s.id)
        return {
          studentId: r.studentId,
          name: r.name,
          matricule: r.matricule,
          statuses: grid.sessions.map((s) => r.statuses[s.id] ?? null),
          ...r.totals,
          rate: round(attendanceRatio(r.totals)),
          ...(overridden.length > 0 ? { overridden } : {}),
        }
      }),
    }
  },
})

export const getCourseCaTool = defineTool({
  name: 'get_course_ca',
  title: 'Get the CA table',
  description:
    "A course's continuous assessment (CA) table, ranked: per student the score of each part (attendance, assignments, " +
    'participation, tests) out of its points, with the part status (scored; not_started for the whole class; not_applicable ' +
    'to this student, so their final is scaled up), the CA so far, the final out of the total, the attendance rate, how many ' +
    'assignments are missing, and `slipping` when the app flags them as falling behind. Also returns the CA settings. ' +
    'Needs courseId from list_courses.',
  scope: 'clasync:read',
  input: z.object({ courseId }),
  run: async (ctx, { courseId }) => {
    const { settings, rows } = await getCourseCa(ctx, courseId)
    return {
      settings,
      students: rows.map((r) => ({
        studentId: r.studentId,
        name: r.name,
        matricule: r.matricule,
        rank: r.rank,
        final: r.result.final,
        total: r.result.total,
        soFar: r.result.soFar,
        soFarOutOf: r.result.soFarOutOf,
        scaled: r.result.scaled,
        notAssessed: r.result.notAssessed,
        parts: Object.fromEntries(
          r.result.components.map((c) => [c.key, { score: c.score, points: c.points, status: c.status }]),
        ),
        attendanceRate: round(r.attendanceRatio),
        missingWork: r.missingWork,
        slipping: r.slipping,
      })),
    }
  },
})

export const courseReadTools = [listCourses, getCourseTool, getAttendance, getCourseCaTool]
