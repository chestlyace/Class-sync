import { describe, expect, it } from 'vitest'
import { lastSessionFigure, pickLikelyNow } from './attendance-summary'

const HOUR = 60 * 60 * 1000
const DAY = 24 * HOUR

describe('lastSessionFigure', () => {
  it('is null for a course with no sessions', () => {
    expect(lastSessionFigure([], [])).toBeNull()
  })

  it('counts present and partial students in the newest session, out of everyone enrolled', () => {
    const sessions = [
      { id: 'old', createdAt: new Date('2026-11-02T08:00:00Z') },
      { id: 'new', createdAt: new Date('2026-11-09T08:00:00Z') },
    ]
    const rows = [
      { statuses: { old: 'absent', new: 'present' } },
      { statuses: { old: 'present', new: 'partial' } },
      { statuses: { old: 'present', new: 'absent' } },
      { statuses: { old: null, new: 'not_enrolled' } },
      { statuses: { old: 'present', new: null } },
    ] as const
    expect(lastSessionFigure(sessions, rows)).toEqual({
      createdAt: new Date('2026-11-09T08:00:00Z'),
      attended: 2,
      total: 4,
    })
  })
})

describe('pickLikelyNow', () => {
  const now = new Date('2026-11-16T08:10:00Z')

  it('picks a session started at about this time a week ago', () => {
    const startedAt = new Date(now.getTime() - 7 * DAY - 0.5 * HOUR)
    expect(pickLikelyNow([{ courseId: 'db', createdAt: startedAt }], now)).toEqual({ courseId: 'db', startedAt })
  })

  it('ignores sessions more than an hour away from this time last week', () => {
    const tooEarly = new Date(now.getTime() - 7 * DAY - 2 * HOUR)
    const otherDay = new Date(now.getTime() - 6 * DAY)
    expect(
      pickLikelyNow(
        [
          { courseId: 'db', createdAt: tooEarly },
          { courseId: 'web', createdAt: otherDay },
        ],
        now,
      ),
    ).toBeNull()
  })

  it('prefers the session closest to this time last week', () => {
    const close = new Date(now.getTime() - 7 * DAY + 10 * 60 * 1000)
    const further = new Date(now.getTime() - 7 * DAY - 50 * 60 * 1000)
    expect(
      pickLikelyNow(
        [
          { courseId: 'web', createdAt: further },
          { courseId: 'db', createdAt: close },
        ],
        now,
      ),
    ).toEqual({ courseId: 'db', startedAt: close })
  })
})
