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
})
