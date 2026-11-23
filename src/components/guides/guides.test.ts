import { describe, expect, it } from 'vitest'
import en from '../../../messages/en.json'
import fr from '../../../messages/fr.json'
import { adjacentStep, autoGuideFor, courseIdFrom, findGuide, GUIDES, guidesFor, hrefFor, onRoute, startOf, stepOnPage, type Guide } from './guides'

function guide(id: string): Guide {
  const g = findGuide(id)
  if (!g) throw new Error(`no guide ${id}`)
  return g
}

const index = (g: Guide, stepId: string) => g.steps.findIndex((s) => s.id === stepId)

describe('guide definitions', () => {
  it('has unique guide ids, and unique step ids within each guide', () => {
    expect(new Set(GUIDES.map((g) => g.id)).size).toBe(GUIDES.length)
    for (const g of GUIDES) expect(new Set(g.steps.map((s) => s.id)).size, g.id).toBe(g.steps.length)
  })

  it('has a title, a description and text for every step, in English and French', () => {
    for (const messages of [en, fr]) {
      const items = messages.guides.items as Record<string, { title: string; description: string; steps: Record<string, { title: string; body: string }> }>
      for (const g of GUIDES) {
        expect(items[g.id]?.title, g.id).toBeTruthy()
        expect(items[g.id]?.description, g.id).toBeTruthy()
        for (const s of g.steps) {
          expect(items[g.id].steps[s.id]?.title, `${g.id}.${s.id}`).toBeTruthy()
          expect(items[g.id].steps[s.id]?.body, `${g.id}.${s.id}`).toBeTruthy()
          const button = (items[g.id].steps[s.id] as { button?: string }).button
          expect(Boolean(button), `${g.id}.${s.id}: button label only when the step has one`).toBe(Boolean(s.button))
        }
        expect(Object.keys(items[g.id].steps).sort(), `${g.id}: no leftover text`).toEqual(g.steps.map((s) => s.id).sort())
      }
      expect(Object.keys(items).sort()).toEqual(GUIDES.map((g) => g.id).sort())
    }
  })

  it('only points "open" steps at something to open', () => {
    for (const g of GUIDES) for (const s of g.steps) if (s.action === 'open') expect(s.target, `${g.id}.${s.id}`).toBeTruthy()
  })

  it('gives each role its own guides, a welcome first', () => {
    expect(guidesFor('lecturer').map((g) => g.id)).toEqual([
      'lecturerWelcome',
      'classAndCourse',
      'attendance',
      'ca',
      'tests',
      'assignments',
      'lecturerCourse',
    ])
    expect(guidesFor('student').map((g) => g.id)).toEqual(['studentWelcome', 'joinClass', 'checkIn', 'takeTest', 'studentCourse'])
  })
})

describe('routes', () => {
  it('tells a course page from the new course form and from its sub-pages', () => {
    expect(onRoute('course', '/courses/abc')).toBe(true)
    expect(onRoute('course', '/courses/new')).toBe(false)
    expect(onRoute('course', '/courses/abc/tests')).toBe(false)
    expect(onRoute('courseTests', '/courses/abc/tests')).toBe(true)
    expect(onRoute('courseTestNew', '/courses/abc/tests/new')).toBe(true)
    expect(onRoute('courseTest', '/courses/abc/tests/new')).toBe(false)
    expect(onRoute('courseTest', '/courses/abc/tests/t1')).toBe(true)
    expect(onRoute('class', '/classes/new')).toBe(false)
    expect(onRoute('class', '/classes/c1')).toBe(true)
    expect(onRoute('join', '/join/ABC123')).toBe(true)
    expect(onRoute(undefined, '/anything')).toBe(true)
  })

  it('reads the course from the path', () => {
    expect(courseIdFrom('/courses/abc/tests/new')).toBe('abc')
    expect(courseIdFrom('/courses/new')).toBeNull()
    expect(courseIdFrom('/dashboard')).toBeNull()
  })

  it('links to course pages only when the course is known', () => {
    expect(hrefFor('courseCa', 'a b')).toBe('/courses/a%20b/performance')
    expect(hrefFor('courseCa', null)).toBeNull()
    expect(hrefFor('dashboard', null)).toBe('/dashboard')
    expect(hrefFor('courseTest', 'abc')).toBeNull()
    expect(hrefFor(undefined, 'abc')).toBeNull()
  })
})

describe('startOf', () => {
  const tests = guide('tests')

  it('starts by picking a course from the dashboard', () => {
    expect(startOf(tests, '/dashboard')).toEqual({ index: 0, href: null })
    expect(startOf(tests, '/check-in')).toEqual({ index: 0, href: '/dashboard' })
  })

  it('skips picking a course when already in one', () => {
    expect(startOf(tests, '/courses/abc')).toEqual({ index: index(tests, 'openTests'), href: null })
    expect(startOf(tests, '/courses/abc/tests')).toEqual({ index: index(tests, 'newTest'), href: null })
    // Elsewhere in the course: back to the course page, where the guide's steps begin.
    expect(startOf(tests, '/courses/abc/notes')).toEqual({ index: index(tests, 'openTests'), href: '/courses/abc' })
  })

  it('opens the first page of a guide that starts outside the dashboard', () => {
    expect(startOf(guide('classAndCourse'), '/schedule')).toEqual({ index: 0, href: '/dashboard' })
    expect(startOf(guide('checkIn'), '/check-in')).toEqual({ index: 1, href: null })
  })
})

describe('stepOnPage', () => {
  const cc = guide('classAndCourse')

  it('keeps the step while the user stays on its page', () => {
    expect(stepOnPage(cc, 0, '/dashboard')).toBe(0)
  })

  it('moves on when the user opens what the step pointed at', () => {
    expect(stepOnPage(cc, index(cc, 'openNewClass'), '/classes/new')).toBe(index(cc, 'classForm'))
    // Saving the class lands on its page: the next step there.
    expect(stepOnPage(cc, index(cc, 'classForm'), '/classes/c1')).toBe(index(cc, 'shareCode'))
    expect(stepOnPage(cc, index(cc, 'courseForm'), '/courses/k1')).toBe(index(cc, 'courseReady'))
  })

  it('goes back with the user', () => {
    expect(stepOnPage(cc, index(cc, 'courseForm'), '/classes/c1')).toBe(index(cc, 'addCourse'))
  })

  it('waits when no step lives on the page', () => {
    expect(stepOnPage(cc, index(cc, 'classForm'), '/settings')).toBeNull()
  })

  it('follows into a step that shows on any page when it comes next', () => {
    const join = guide('joinClass')
    // Joining sends the student to the class page: "you're in" shows there.
    expect(stepOnPage(join, index(join, 'form'), '/classes/c1')).toBe(index(join, 'after'))
    const assignments = guide('assignments')
    expect(stepOnPage(assignments, index(assignments, 'form'), '/courses/k/assignments/a1/edit')).toBe(index(assignments, 'publish'))
  })
})

describe('autoGuideFor', () => {
  it('starts the welcome on the dashboard and the course tour on a course, once', () => {
    expect(autoGuideFor('lecturer', '/dashboard', new Set())?.id).toBe('lecturerWelcome')
    expect(autoGuideFor('student', '/dashboard', new Set())?.id).toBe('studentWelcome')
    expect(autoGuideFor('student', '/courses/abc', new Set())?.id).toBe('studentCourse')
    expect(autoGuideFor('lecturer', '/dashboard', new Set(['lecturerWelcome']))).toBeNull()
    expect(autoGuideFor('lecturer', '/courses/abc/tests', new Set())).toBeNull()
  })
})

describe('side trips', () => {
  const cc = guide('classAndCourse')

  it('shows the school step only when the user goes to add a school', () => {
    // From the class form, adding a school steps back to it; coming back to the class form steps on.
    expect(stepOnPage(cc, index(cc, 'classForm'), '/schools/new')).toBe(index(cc, 'schoolForm'))
    expect(stepOnPage(cc, index(cc, 'schoolForm'), '/classes/new')).toBe(index(cc, 'classForm'))
  })

  it('is passed over by Next and Back', () => {
    expect(adjacentStep(cc, index(cc, 'openNewClass'), 1)).toBe(index(cc, 'classForm'))
    expect(adjacentStep(cc, index(cc, 'classForm'), -1)).toBe(index(cc, 'openNewClass'))
    expect(adjacentStep(cc, 0, -1)).toBe(-1)
  })
})
