import { describe, expect, it } from 'vitest'
import { pushPayload } from './payload'

describe('pushPayload', () => {
  it('builds the check-in text in French with the closing time', () => {
    const p = pushPayload('checkInOpened', 'fr', {
      url: '/check-in',
      tag: 'checkin-w1',
      courseTitle: 'Réseaux',
      closesAt: new Date('2026-11-12T09:15:00Z'),
    })
    expect(p.title).toBe('Réseaux')
    expect(p.body).toBe('Le pointage de début de cours est ouvert. Il se ferme à 10:15.')
    expect(p.url).toBe('/check-in')
    expect(p.tag).toBe('checkin-w1')
    expect(p.kind).toBe('checkInOpened')
  })

  it('calls the check-out window a pointage too, in French', () => {
    const p = pushPayload('checkOutOpened', 'fr', {
      url: '/check-in',
      tag: 'checkin-w2',
      courseTitle: 'Réseaux',
      closesAt: new Date('2026-11-12T10:15:00Z'),
    })
    expect(p.body).toBe('Le pointage de fin de cours est ouvert. Il se ferme à 11:15.')
  })

  it('never includes a mark for results', () => {
    const p = pushPayload('testResultsReleased', 'en', {
      url: '/t/abc/result',
      tag: 'results-t1',
      courseTitle: 'Networking',
      testTitle: 'Test 2',
    })
    expect(p.body).toContain('Test 2')
    expect(p.body).not.toMatch(/\d+\s*(\/|%|points?)/)
  })

  it('collapses newlines in titles', () => {
    const p = pushPayload('notesAdded', 'en', {
      url: '/x',
      tag: 'notes-c1',
      courseTitle: 'Net\nworking\r\n  101',
      itemTitle: 'Week\n3  slides',
    })
    expect(p.title).toBe('Net working 101')
    expect(p.body).toBe('New: Week 3 slides')
  })

  it('rejects an absolute url', () => {
    expect(() => pushPayload('test', 'en', { url: 'https://evil.example/x', tag: 'test' })).toThrow()
  })

  it('uses Clasync as the title of the test kind and keeps the given tag', () => {
    const p = pushPayload('test', 'en', { url: '/settings', tag: 'test' })
    expect(p.title).toBe('Clasync')
    expect(p.tag).toBe('test')
  })

  it('never falls back to the kind as the tag: two events of one kind keep their own tags', () => {
    const vars = { url: '/a', courseTitle: 'C', assignmentTitle: 'Lab', dueAt: new Date('2026-11-14T10:00:00Z') }
    const first = pushPayload('assignmentReminder', 'en', { ...vars, tag: 'assignment-a1' })
    const second = pushPayload('assignmentReminder', 'en', { ...vars, tag: 'assignment-a2' })
    expect(first.tag).toBe('assignment-a1')
    expect(second.tag).toBe('assignment-a2')
  })

  it('formats due dates in the app time zone', () => {
    const p = pushPayload('assignmentPublished', 'en', {
      url: '/a',
      tag: 'assignment-a1',
      courseTitle: 'C',
      assignmentTitle: 'Lab 3',
      dueAt: new Date('2026-11-14T23:30:00Z'),
    })
    expect(p.body).toBe('New assignment: Lab 3, due 15 Nov.')
  })
  describe('class kinds', () => {
    const base = {
      url: '/dashboard',
      tag: 'class-x-y',
      courseTitle: 'Networking',
      startsAt: new Date('2026-11-10T07:00:00Z'),
      day: new Date('2026-11-10T07:00:00Z'),
      newDay: new Date('2026-11-12T13:30:00Z'),
    }
    const body = (kind: Parameters<typeof pushPayload>[0], locale: 'en' | 'fr', vars = {}) =>
      pushPayload(kind, locale, { ...base, ...vars }).body

    it('classSoonLecturer, with and without a room', () => {
      expect(body('classSoonLecturer', 'en', { room: 'B2' })).toBe('Class at 08:00 \u00b7 B2. Tap to open check-in.')
      expect(body('classSoonLecturer', 'en', { room: null })).toBe('Class at 08:00. Tap to open check-in.')
      expect(body('classSoonLecturer', 'fr', { room: 'B2' })).toBe('Cours \u00e0 08:00 \u00b7 B2. Touchez pour ouvrir l\u2019appel.')
      expect(body('classSoonLecturer', 'fr')).toBe('Cours \u00e0 08:00. Touchez pour ouvrir l\u2019appel.')
    })

    it('classSoon, with and without a room (blank counts as none)', () => {
      expect(body('classSoon', 'en', { room: 'B2' })).toBe('Class at 08:00 \u00b7 B2.')
      expect(body('classSoon', 'en', { room: '  ' })).toBe('Class at 08:00.')
      expect(body('classSoon', 'fr', { room: 'B2' })).toBe('Cours \u00e0 08:00 \u00b7 B2.')
      expect(body('classSoon', 'fr', { room: null })).toBe('Cours \u00e0 08:00.')
    })

    it('classCancelled', () => {
      expect(body('classCancelled', 'en')).toBe('The class on Tue 10 Nov at 08:00 is cancelled.')
      expect(body('classCancelled', 'fr')).toBe('Le cours du mar. 10 nov. \u00e0 08:00 est annul\u00e9.')
    })

    it('classReinstated', () => {
      expect(body('classReinstated', 'en')).toBe('The class on Tue 10 Nov at 08:00 is back on.')
      expect(body('classReinstated', 'fr')).toBe('Le cours du mar. 10 nov. \u00e0 08:00 est r\u00e9tabli.')
    })

    it('classMoved shows the old day and the new day and start', () => {
      expect(body('classMoved', 'en', { startsAt: base.newDay })).toBe(
        'The class on Tue 10 Nov moved to Thu 12 Nov at 14:30.',
      )
      expect(body('classMoved', 'fr', { startsAt: base.newDay })).toBe(
        'Le cours du mar. 10 nov. est d\u00e9plac\u00e9 au jeu. 12 nov. \u00e0 14:30.',
      )
    })

    it('classMakeUp, with and without a room', () => {
      const v = { startsAt: base.newDay }
      expect(body('classMakeUp', 'en', { ...v, room: 'A1' })).toBe('Make-up class on Thu 12 Nov at 14:30 \u00b7 A1.')
      expect(body('classMakeUp', 'en', v)).toBe('Make-up class on Thu 12 Nov at 14:30.')
      expect(body('classMakeUp', 'fr', { ...v, room: 'A1' })).toBe(
        'Cours de rattrapage le jeu. 12 nov. \u00e0 14:30 \u00b7 A1.',
      )
      expect(body('classMakeUp', 'fr', v)).toBe('Cours de rattrapage le jeu. 12 nov. \u00e0 14:30.')
    })

    it('classMissedQuestion and timetableChanged', () => {
      expect(body('classMissedQuestion', 'en')).toBe('No attendance was taken on Tue 10 Nov. Was the class missed?')
      expect(body('classMissedQuestion', 'fr')).toBe('Aucun appel le mar. 10 nov. : le cours a-t-il \u00e9t\u00e9 manqu\u00e9 ?')
      expect(body('timetableChanged', 'en')).toBe('The class timetable changed.')
      expect(body('timetableChanged', 'fr')).toBe('L\u2019emploi du temps a chang\u00e9.')
    })

    it('shows a room literally named "none"', () => {
      expect(body('classSoon', 'en', { room: 'none' })).toBe('Class at 08:00 \u00b7 none.')
      expect(body('classSoonLecturer', 'fr', { room: 'none' })).toBe(
        'Cours \u00e0 08:00 \u00b7 none. Touchez pour ouvrir l\u2019appel.',
      )
      expect(body('classMakeUp', 'en', { startsAt: base.newDay, room: 'none' })).toBe(
        'Make-up class on Thu 12 Nov at 14:30 \u00b7 none.',
      )
      expect(body('classMakeUp', 'fr', { startsAt: base.newDay, room: 'none' })).toBe(
        'Cours de rattrapage le jeu. 12 nov. \u00e0 14:30 \u00b7 none.',
      )
    })

    it('keeps the course title as the title and the room on one line', () => {
      const p = pushPayload('classSoon', 'en', { ...base, room: 'B2\n  Annex' })
      expect(p.title).toBe('Networking')
      expect(p.body).toBe('Class at 08:00 \u00b7 B2 Annex.')
    })
  })
})
