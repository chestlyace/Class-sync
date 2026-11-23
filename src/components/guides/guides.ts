import type { Role } from '@/server/core/context'

/**
 * The in-app guides: short tours that point at the real buttons and forms, one step at a time,
 * and follow the user from page to page. Pure data and pure functions, so the rules about where
 * a step lives and where a guide starts are tested without a browser (guides.test.ts).
 *
 * Step text lives in messages under `guides.<guideId>.steps.<stepId>` (`title` and `body`).
 */

/** The pages a step can live on. A step with no route can show on any page. */
export const ROUTES = {
  dashboard: /^\/dashboard$/,
  join: /^\/join(\/[^/]+)?$/,
  checkIn: /^\/check-in$/,
  schoolNew: /^\/schools\/new$/,
  classNew: /^\/classes\/new$/,
  class: /^\/classes\/(?!new$)[^/]+$/,
  courseNew: /^\/courses\/new$/,
  course: /^\/courses\/(?!new$)[^/]+$/,
  courseAttendance: /^\/courses\/[^/]+\/attendance$/,
  courseCa: /^\/courses\/[^/]+\/performance$/,
  courseTests: /^\/courses\/[^/]+\/tests$/,
  courseTestNew: /^\/courses\/[^/]+\/tests\/new$/,
  courseTest: /^\/courses\/[^/]+\/tests\/(?!new$)[^/]+$/,
  courseAssignments: /^\/courses\/[^/]+\/assignments$/,
  courseAssignmentNew: /^\/courses\/[^/]+\/assignments\/new$/,
} as const satisfies Record<string, RegExp>

export type RouteKey = keyof typeof ROUTES

export type GuideStep = {
  id: string
  /** The page this step belongs to; none means any page. */
  route?: RouteKey
  /** CSS selector of the element to point at; none (or nothing visible) shows the card in the middle. */
  target?: string
  /**
   * The target is what the user does next (a link to open, a form's save button): the main button
   * presses it and the guide goes on where that leads. Labelled "Open it", or `steps.<id>.button`
   * in the messages when `button` is set.
   */
  action?: 'open'
  /** The main button has its own label (messages: `steps.<id>.button`). */
  button?: boolean
  /** Skip the step when its target isn't on the page (e.g. the setup checklist once it is done). */
  optional?: boolean
  /** A side trip: shown only when the user goes to its page themselves; Next and Back pass over it. */
  detour?: boolean
}

export type Guide = {
  id: string
  role: Role
  /** Starts by itself the first time the user lands on this page. */
  autoStart?: RouteKey
  steps: GuideStep[]
}

const tour = (name: string) => `[data-tour="${name}"]`

/** First step of the guides that happen inside a course, when the user isn't in one yet. */
const pickCourse: GuideStep = { id: 'pickCourse', route: 'dashboard', target: tour('course-card'), action: 'open' }

export const GUIDES: readonly Guide[] = [
  // Lecturers
  {
    id: 'lecturerWelcome',
    role: 'lecturer',
    autoStart: 'dashboard',
    steps: [
      { id: 'hello', route: 'dashboard' },
      { id: 'menu', route: 'dashboard', target: tour('nav') },
      { id: 'create', route: 'dashboard', target: tour('new-course') },
      { id: 'checklist', route: 'dashboard', target: '[data-testid="setup-checklist"]', optional: true },
      { id: 'help', route: 'dashboard', target: tour('help') },
    ],
  },
  {
    id: 'classAndCourse',
    role: 'lecturer',
    steps: [
      { id: 'openNewClass', route: 'dashboard', target: tour('new-class'), action: 'open' },
      // Before the class form, so going to add a school from it steps back here, and coming back steps on.
      { id: 'schoolForm', route: 'schoolNew', target: tour('school-form'), detour: true },
      { id: 'classForm', route: 'classNew', target: tour('class-form') },
      { id: 'shareCode', route: 'class', target: tour('class-codes') },
      { id: 'addCourse', route: 'class', target: tour('add-course'), action: 'open' },
      { id: 'courseForm', route: 'courseNew', target: tour('course-form') },
      { id: 'courseReady', route: 'course', target: tour('course-attendance') },
    ],
  },
  {
    id: 'attendance',
    role: 'lecturer',
    steps: [
      pickCourse,
      { id: 'openAttendance', route: 'course', target: tour('course-attendance'), action: 'open' },
      { id: 'startSession', route: 'courseAttendance', target: tour('new-session') },
      { id: 'checkInCode', route: 'courseAttendance' },
      { id: 'sessions', route: 'courseAttendance', target: tour('sessions') },
    ],
  },
  {
    id: 'ca',
    role: 'lecturer',
    steps: [
      pickCourse,
      { id: 'openCa', route: 'course', target: tour('course-ca'), action: 'open' },
      { id: 'settings', route: 'courseCa', target: tour('ca-settings') },
      { id: 'table', route: 'courseCa', target: tour('ca-table') },
      { id: 'participation', route: 'courseCa', target: tour('ca-participation') },
      { id: 'export', route: 'courseCa', target: tour('ca-export') },
    ],
  },
  {
    id: 'tests',
    role: 'lecturer',
    steps: [
      pickCourse,
      { id: 'openTests', route: 'course', target: tour('course-tests'), action: 'open' },
      { id: 'newTest', route: 'courseTests', target: tour('new-test'), action: 'open' },
      { id: 'questions', route: 'courseTestNew', target: '#test-title' },
      { id: 'weight', route: 'courseTestNew', target: '#test-weight' },
      { id: 'save', route: 'courseTestNew', target: tour('test-save'), action: 'open', button: true },
      { id: 'share', route: 'courseTest', target: 'section[aria-labelledby="test-link"]' },
      { id: 'release', route: 'courseTest' },
    ],
  },
  {
    id: 'assignments',
    role: 'lecturer',
    steps: [
      pickCourse,
      { id: 'openAssignments', route: 'course', target: tour('course-assignments'), action: 'open' },
      { id: 'newAssignment', route: 'courseAssignments', target: tour('new-assignment'), action: 'open' },
      { id: 'form', route: 'courseAssignmentNew', target: 'main form' },
      // Saving the draft opens the assignment's edit page: this step follows there.
      { id: 'publish' },
    ],
  },
  {
    id: 'lecturerCourse',
    role: 'lecturer',
    autoStart: 'course',
    steps: [
      { id: 'hello', route: 'course' },
      { id: 'attendance', route: 'course', target: tour('course-attendance') },
      { id: 'timetable', route: 'course', target: tour('course-timetable') },
      { id: 'work', route: 'course', target: tour('course-tests') },
      { id: 'notes', route: 'course', target: tour('course-notes') },
      { id: 'ca', route: 'course', target: tour('course-ca') },
      { id: 'roster', route: 'course', target: tour('course-roster') },
    ],
  },

  // Students
  {
    id: 'studentWelcome',
    role: 'student',
    autoStart: 'dashboard',
    steps: [
      { id: 'hello', route: 'dashboard' },
      { id: 'menu', route: 'dashboard', target: tour('nav') },
      { id: 'join', route: 'dashboard', target: tour('join-class') },
      { id: 'checklist', route: 'dashboard', target: '[data-testid="setup-checklist"]', optional: true },
      { id: 'help', route: 'dashboard', target: tour('help') },
    ],
  },
  {
    id: 'joinClass',
    role: 'student',
    steps: [
      { id: 'openJoin', route: 'dashboard', target: tour('join-class'), action: 'open' },
      { id: 'form', route: 'join', target: tour('join-form') },
      { id: 'after' },
    ],
  },
  {
    id: 'checkIn',
    role: 'student',
    steps: [
      { id: 'openCheckIn', route: 'dashboard', target: `${tour('nav')} a[href="/check-in"]`, action: 'open' },
      { id: 'code', route: 'checkIn', target: tour('check-in') },
      { id: 'after', route: 'checkIn' },
    ],
  },
  {
    id: 'takeTest',
    role: 'student',
    steps: [
      pickCourse,
      { id: 'myTests', route: 'course', target: tour('my-tests') },
      { id: 'waiting' },
      { id: 'leaving' },
      { id: 'results' },
    ],
  },
  {
    id: 'studentCourse',
    role: 'student',
    autoStart: 'course',
    steps: [
      { id: 'hello', route: 'course' },
      { id: 'tests', route: 'course', target: tour('my-tests'), optional: true },
      { id: 'notes', route: 'course', target: tour('my-notes'), optional: true },
      { id: 'assignments', route: 'course', target: tour('my-assignments'), optional: true },
      { id: 'attendance', route: 'course', target: tour('my-attendance'), optional: true },
      { id: 'ca', route: 'course', target: tour('my-ca'), optional: true },
    ],
  },
]

export function guidesFor(role: Role): Guide[] {
  return GUIDES.filter((g) => g.role === role)
}

export function findGuide(id: string): Guide | undefined {
  return GUIDES.find((g) => g.id === id)
}

export function onRoute(route: RouteKey | undefined, pathname: string): boolean {
  return route === undefined || ROUTES[route].test(pathname)
}

/** The course the path is inside, if any (`/courses/new` is not a course). */
export function courseIdFrom(pathname: string): string | null {
  const m = /^\/courses\/([^/]+)/.exec(pathname)
  return m && m[1] !== 'new' ? decodeURIComponent(m[1]) : null
}

/** Where to send the user for a step's page; null when that page needs a course we don't know. */
export function hrefFor(route: RouteKey | undefined, courseId: string | null): string | null {
  switch (route) {
    case undefined:
      return null
    case 'dashboard':
      return '/dashboard'
    case 'join':
      return '/join'
    case 'checkIn':
      return '/check-in'
    case 'schoolNew':
      return '/schools/new'
    case 'classNew':
      return '/classes/new'
    case 'courseNew':
      return '/courses/new'
    case 'class':
    case 'courseTest':
      return null // a particular class or test: only reached by opening it
  }
  if (!courseId) return null
  const base = `/courses/${encodeURIComponent(courseId)}`
  switch (route) {
    case 'course':
      return base
    case 'courseAttendance':
      return `${base}/attendance`
    case 'courseCa':
      return `${base}/performance`
    case 'courseTests':
      return `${base}/tests`
    case 'courseTestNew':
      return `${base}/tests/new`
    case 'courseAssignments':
      return `${base}/assignments`
    case 'courseAssignmentNew':
      return `${base}/assignments/new`
  }
}

/**
 * Where a guide begins when started from Help on `pathname`: at the first step that lives on this
 * page if there is one (inside a course, the course guides skip "open a course"), else at the
 * guide's course page when the user is in a course, else at the first step, on its own page.
 * `href` is where to go first, or null to stay.
 */
export function startOf(guide: Guide, pathname: string): { index: number; href: string | null } {
  const here = guide.steps.findIndex((s) => s.route !== undefined && onRoute(s.route, pathname))
  if (here !== -1) return { index: here, href: null }
  const courseId = courseIdFrom(pathname)
  if (courseId) {
    const inCourse = guide.steps.findIndex((s) => s.route === 'course')
    if (inCourse !== -1) return { index: inCourse, href: hrefFor('course', courseId) }
  }
  const first = guide.steps[0]
  return { index: 0, href: onRoute(first.route, pathname) ? null : hrefFor(first.route, courseId) }
}

/** The step Next (dir 1) or Back (dir -1) goes to from `index`, passing over side trips; may be out of range. */
export function adjacentStep(guide: Guide, index: number, dir: 1 | -1): number {
  let i = index + dir
  while (i >= 0 && i < guide.steps.length && guide.steps[i].detour) i += dir
  return i
}

/**
 * After the user moved to `pathname` during a guide: the step to show now. The current step when
 * it lives here, else the nearest later step that does (the user opened what the guide pointed
 * at), else the nearest earlier one (they went back). A step that shows on any page counts as
 * living here only when it comes right next (e.g. "you joined" after the join form sends the user
 * on). Null: no step lives here, the guide waits.
 */
export function stepOnPage(guide: Guide, index: number, pathname: string): number | null {
  const steps = guide.steps
  if (onRoute(steps[index].route, pathname)) return index
  if (index + 1 < steps.length && steps[index + 1].route === undefined) return index + 1
  for (let i = index + 1; i < steps.length; i++) if (steps[i].route && onRoute(steps[i].route, pathname)) return i
  for (let i = index - 1; i >= 0; i--) if (steps[i].route && onRoute(steps[i].route, pathname)) return i
  return null
}

/** Auto-started guide for this page, if the user hasn't seen it yet. */
export function autoGuideFor(role: Role, pathname: string, seen: ReadonlySet<string>): Guide | null {
  return GUIDES.find((g) => g.role === role && g.autoStart && !seen.has(g.id) && onRoute(g.autoStart, pathname)) ?? null
}
