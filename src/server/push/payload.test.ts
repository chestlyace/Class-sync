import { describe, expect, it } from 'vitest'
import { pushPayload } from './payload'

describe('pushPayload', () => {
  it('builds the check-in text in French with the closing time', () => {
    const p = pushPayload('checkInOpened', 'fr', {
      url: '/check-in',
      courseTitle: 'Réseaux',
      closesAt: new Date('2026-11-12T09:15:00Z'),
    })
    expect(p.title).toBe('Réseaux')
    expect(p.body).toContain('10:15')
    expect(p.url).toBe('/check-in')
    expect(p.tag).toBe('checkInOpened')
    expect(p.kind).toBe('checkInOpened')
  })

  it('never includes a mark for results', () => {
    const p = pushPayload('testResultsReleased', 'en', {
      url: '/t/abc/result',
      courseTitle: 'Networking',
      testTitle: 'Test 2',
    })
    expect(p.body).toContain('Test 2')
    expect(p.body).not.toMatch(/\d+\s*(\/|%|points?)/)
  })

  it('collapses newlines in titles', () => {
    const p = pushPayload('notesAdded', 'en', {
      url: '/x',
      courseTitle: 'Net\nworking\r\n  101',
      itemTitle: 'Week\n3  slides',
    })
    expect(p.title).toBe('Net working 101')
    expect(p.body).toBe('New: Week 3 slides')
  })

  it('rejects an absolute url', () => {
    expect(() => pushPayload('test', 'en', { url: 'https://evil.example/x' })).toThrow()
  })

  it('uses Clasync as the title of the test kind and honours a custom tag', () => {
    const p = pushPayload('test', 'en', { url: '/settings', tag: 'custom' })
    expect(p.title).toBe('Clasync')
    expect(p.tag).toBe('custom')
  })

  it('formats due dates in the app time zone', () => {
    const p = pushPayload('assignmentPublished', 'en', {
      url: '/a',
      courseTitle: 'C',
      assignmentTitle: 'Lab 3',
      dueAt: new Date('2026-11-14T23:30:00Z'),
    })
    expect(p.body).toBe('New assignment: Lab 3, due 15 Nov.')
  })
})
