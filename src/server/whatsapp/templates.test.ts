import { describe, expect, it } from 'vitest'
import { buildTemplate, buildVerificationTemplate } from './templates'

// 14:30 in Africa/Douala (UTC+1) on Monday 16 November 2026.
const at = new Date('2026-11-16T13:30:00Z')

describe('buildTemplate', () => {
  it('checkin_open gives the course, the closing time and the check-in path', () => {
    const msg = buildTemplate('checkinOpen', { courseTitle: 'Biologie', closesAt: at }, 'fr')
    expect(msg).toEqual({ name: 'checkin_open', language: 'fr', bodyParams: ['Biologie', '14:30'], buttonPath: 'check-in' })
  })

  it('test_started gives the test, the course and the test path', () => {
    const msg = buildTemplate('testStarted', { testTitle: 'CA 1', courseTitle: 'Biologie', code: 'AB12CD' }, 'fr')
    expect(msg).toEqual({ name: 'test_started', language: 'fr', bodyParams: ['CA 1', 'Biologie'], buttonPath: 't/AB12CD' })
  })

  it('results_released points an assignment at its page and a test at its result screen', () => {
    const a = buildTemplate(
      'resultsReleased',
      { source: 'assignment', itemTitle: 'Devoir 1', courseTitle: 'Biologie', assignmentId: 'a-1' },
      'fr',
    )
    expect(a).toEqual({
      name: 'results_released',
      language: 'fr',
      bodyParams: ['Devoir 1', 'Biologie'],
      buttonPath: 'assignments/a-1',
    })
    const t = buildTemplate('resultsReleased', { source: 'test', itemTitle: 'CA 1', courseTitle: 'Biologie', code: 'AB12CD' }, 'fr')
    expect(t.buttonPath).toBe('t/AB12CD')
  })

  it('assignment_published gives the due date as weekday, day, month and time in the locale', () => {
    const msg = buildTemplate(
      'assignmentPublished',
      { courseTitle: 'Biologie', assignmentTitle: 'Devoir 1', dueAt: at, assignmentId: 'a-1' },
      'fr',
    )
    expect(msg.name).toBe('assignment_published')
    expect(msg.language).toBe('fr')
    expect(msg.bodyParams.slice(0, 2)).toEqual(['Biologie', 'Devoir 1'])
    expect(msg.bodyParams[2]).toMatch(/lun\.? 16 nov\.?,? 14:30/)
    expect(msg.buttonPath).toBe('assignments/a-1')
    const en = buildTemplate(
      'assignmentPublished',
      { courseTitle: 'Biology', assignmentTitle: 'Essay', dueAt: at, assignmentId: 'a-1' },
      'en',
    )
    expect(en.bodyParams[2]).toMatch(/Mon,? 16 Nov,? 14:30/)
  })

  it('class_soon_lecturer gives the course, the start time and the sitting path', () => {
    const msg = buildTemplate('classSoonLecturer', { courseTitle: 'Biologie', startsAt: at, sittingKey: 'slot:2026-11-16' }, 'fr')
    expect(msg).toEqual({
      name: 'class_soon_lecturer',
      language: 'fr',
      bodyParams: ['Biologie', '14:30'],
      buttonPath: 'schedule/class/slot%3A2026-11-16',
    })
  })

  it('keeps parameters on one line and bounded', () => {
    const msg = buildTemplate('testStarted', { testTitle: 'A\n\n  B\tC', courseTitle: 'x'.repeat(500), code: 'Z' }, 'en')
    expect(msg.bodyParams[0]).toBe('A B C')
    expect(msg.bodyParams[1]).toHaveLength(150)
  })
})

describe('buildVerificationTemplate', () => {
  it('puts the code in the body and in the copy-code button', () => {
    expect(buildVerificationTemplate('123456', 'fr')).toEqual({
      name: 'verification_code',
      language: 'fr',
      bodyParams: ['123456'],
      buttonPath: '123456',
    })
  })
})
