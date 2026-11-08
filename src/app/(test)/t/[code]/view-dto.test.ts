import { describe, expect, it } from 'vitest'
import type { AttemptView } from '@/server/tests/attempt'
import { toAttemptViewDto } from './view-dto'

const view: AttemptView = {
  attemptId: 'a1',
  stage: 'answering',
  info: {
    title: 'CA 1',
    courseTitle: 'Biology',
    durationMinutes: 30,
    questionCount: 1,
    totalMarks: 2,
    rule: { maxExits: 3, maxAbsenceSeconds: 10 },
    hasShort: false,
  },
  endsAt: new Date('2026-11-09T08:30:00Z'),
  serverNow: new Date('2026-11-09T08:00:05Z'),
  exitsSoFar: 1,
  paper: [{ id: 'q1', kind: 'mcq', prompt: 'Pick', mark: 2, options: [{ id: 'o1', text: 'A' }] }],
  saved: [{ questionId: 'q1', optionId: 'o1', text: null, rev: 2 }],
  result: null,
  awaitingRelease: false,
}

describe('toAttemptViewDto', () => {
  it('turns dates into ISO strings and keeps the rest', () => {
    const dto = toAttemptViewDto({ ...view, acceptedRevs: { q1: 2 } })
    expect(dto).toMatchObject({ endsAt: '2026-11-09T08:30:00.000Z', serverNow: '2026-11-09T08:00:05.000Z', acceptedRevs: { q1: 2 } })
    expect(dto.paper).toEqual(view.paper)
    expect(JSON.parse(JSON.stringify(dto))).toEqual(dto)
  })

  it('has no deadline before Start and no acknowledged revs on open', () => {
    const dto = toAttemptViewDto({ ...view, stage: 'waiting', endsAt: null, paper: null })
    expect(dto.endsAt).toBeNull()
    expect(dto.acceptedRevs).toEqual({})
  })
})
