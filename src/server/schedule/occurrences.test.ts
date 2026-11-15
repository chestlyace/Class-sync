import { describe, expect, it } from 'vitest'
import {
  buildSittings,
  expandOccurrences,
  parseOccurrenceKey,
  SITTING_GAP_MS,
  type ExtraRow,
  type SlotRow,
  type StatusRow,
} from './occurrences'

const tz = 'Africa/Douala'

function slot(over: Partial<SlotRow> = {}): SlotRow {
  return {
    id: 's1',
    courseId: 'c1',
    weekday: 1,
    startMinute: 480,
    endMinute: 600,
    room: 'A1',
    requireOnCampus: false,
    startsOn: '2026-11-01',
    endsOn: '2026-12-31',
    createdBy: 'u1',
    createdAt: new Date('2026-11-01T00:00:00Z'),
    ...over,
  }
}

function extra(over: Partial<ExtraRow> = {}): ExtraRow {
  return {
    id: 'e1',
    courseId: 'c1',
    startsAt: new Date('2026-11-17T07:00:00Z'),
    endsAt: new Date('2026-11-17T09:00:00Z'),
    room: null,
    requireOnCampus: false,
    replacesSlotId: null,
    replacesDate: null,
    status: null,
    createdBy: 'u1',
    createdAt: new Date('2026-11-01T00:00:00Z'),
    ...over,
  }
}

function status(over: Partial<StatusRow> = {}): StatusRow {
  return {
    slotId: 's1',
    date: '2026-11-16',
    status: 'cancelled',
    setBy: 'u1',
    setAt: new Date('2026-11-10T00:00:00Z'),
    ...over,
  }
}

function expand(input: { slots?: SlotRow[]; statuses?: StatusRow[]; extras?: ExtraRow[]; from: string; to: string }) {
  return expandOccurrences({ slots: [], statuses: [], extras: [], timeZone: tz, ...input })
}

describe('expandOccurrences', () => {
  it('expands a Monday 08:00-10:00 slot across two weeks', () => {
    const occ = expand({ slots: [slot()], from: '2026-11-16', to: '2026-11-29' })
    expect(occ).toHaveLength(2)
    expect(occ.map((o) => o.startsAt.toISOString())).toEqual(['2026-11-16T07:00:00.000Z', '2026-11-23T07:00:00.000Z'])
    expect(occ[0]).toMatchObject({
      key: 'slot:s1:2026-11-16',
      courseId: 'c1',
      date: '2026-11-16',
      room: 'A1',
      requireOnCampus: false,
      status: null,
      source: { kind: 'slot', slotId: 's1' },
    })
    expect(occ[0].endsAt.toISOString()).toBe('2026-11-16T09:00:00.000Z')
  })

  it('respects term bounds inclusively', () => {
    // 2026-11-04 is a Wednesday, 2026-11-23 a Monday.
    const occ = expand({ slots: [slot({ startsOn: '2026-11-04', endsOn: '2026-11-23' })], from: '2026-10-01', to: '2026-12-31' })
    expect(occ.map((o) => o.date)).toEqual(['2026-11-09', '2026-11-16', '2026-11-23'])
  })

  it('includes the from and to days themselves', () => {
    const occ = expand({ slots: [slot()], from: '2026-11-16', to: '2026-11-23' })
    expect(occ.map((o) => o.date)).toEqual(['2026-11-16', '2026-11-23'])
  })

  it('applies a cancelled status', () => {
    const occ = expand({ slots: [slot()], statuses: [status()], from: '2026-11-16', to: '2026-11-29' })
    expect(occ).toHaveLength(2)
    expect(occ[0].status).toBe('cancelled')
    expect(occ[1].status).toBeNull()
  })

  it('ignores statuses for other slots', () => {
    const occ = expand({ slots: [slot()], statuses: [status({ slotId: 'other' })], from: '2026-11-16', to: '2026-11-16' })
    expect(occ[0].status).toBeNull()
  })

  it('includes extras in range, sorted by start', () => {
    const occ = expand({
      slots: [slot()],
      extras: [
        extra({ id: 'late', startsAt: new Date('2026-11-23T14:00:00Z'), endsAt: new Date('2026-11-23T15:00:00Z') }),
        extra({ id: 'early' }),
        extra({ id: 'out', startsAt: new Date('2026-12-10T07:00:00Z'), endsAt: new Date('2026-12-10T08:00:00Z') }),
      ],
      from: '2026-11-16',
      to: '2026-11-29',
    })
    expect(occ.map((o) => o.key)).toEqual([
      'slot:s1:2026-11-16',
      'extra:early',
      'slot:s1:2026-11-23',
      'extra:late',
    ])
    const e = occ[1]
    expect(e.date).toBe('2026-11-17')
    expect(e.source).toEqual({ kind: 'extra', extraId: 'early', replaces: null })
  })

  it('dates an extra by its local start (late evening UTC is next day locally)', () => {
    const occ = expand({
      extras: [extra({ startsAt: new Date('2026-11-17T23:30:00Z'), endsAt: new Date('2026-11-18T00:30:00Z') })],
      from: '2026-11-18',
      to: '2026-11-18',
    })
    expect(occ).toHaveLength(1)
    expect(occ[0].date).toBe('2026-11-18')
  })

  it('carries an extra status and what it replaces', () => {
    const occ = expand({
      extras: [extra({ status: 'taught', replacesSlotId: 's1', replacesDate: '2026-11-16' })],
      from: '2026-11-16',
      to: '2026-11-29',
    })
    expect(occ[0].status).toBe('taught')
    expect(occ[0].source).toEqual({ kind: 'extra', extraId: 'e1', replaces: { slotId: 's1', date: '2026-11-16' } })
  })

  it('keeps replaces when the slot was deleted (null slot, date kept)', () => {
    const occ = expand({
      extras: [extra({ replacesSlotId: null, replacesDate: '2026-11-16' })],
      from: '2026-11-16',
      to: '2026-11-29',
    })
    expect(occ[0].source).toEqual({ kind: 'extra', extraId: 'e1', replaces: { slotId: null, date: '2026-11-16' } })
  })

  it('is empty when from is after to', () => {
    expect(expand({ slots: [slot()], from: '2026-11-23', to: '2026-11-16' })).toEqual([])
  })
})

function occ(key: string, start: string, end: string, status: 'cancelled' | 'missed' | 'taught' | null = null, courseId = 'c1') {
  const startsAt = new Date(start)
  return {
    key,
    courseId,
    date: '2026-11-16',
    startsAt,
    endsAt: new Date(end),
    room: null,
    requireOnCampus: false,
    status,
    source: { kind: 'slot' as const, slotId: 's' },
  }
}

describe('buildSittings', () => {
  it('joins back-to-back classes into one sitting', () => {
    const sittings = buildSittings([
      occ('slot:a:2026-11-16', '2026-11-16T07:00:00Z', '2026-11-16T09:00:00Z'),
      occ('slot:b:2026-11-16', '2026-11-16T09:20:00Z', '2026-11-16T11:00:00Z'),
    ])
    expect(sittings).toHaveLength(1)
    expect(sittings[0].key).toBe('slot:a:2026-11-16')
    expect(sittings[0].startsAt.toISOString()).toBe('2026-11-16T07:00:00.000Z')
    expect(sittings[0].endsAt.toISOString()).toBe('2026-11-16T11:00:00.000Z')
    expect(sittings[0].occurrences).toHaveLength(2)
  })

  it('joins at exactly the gap limit and overlaps', () => {
    expect(SITTING_GAP_MS).toBe(1_800_000)
    const at = buildSittings([
      occ('a', '2026-11-16T07:00:00Z', '2026-11-16T09:00:00Z'),
      occ('b', '2026-11-16T09:30:00Z', '2026-11-16T10:00:00Z'),
    ])
    expect(at).toHaveLength(1)
    const overlap = buildSittings([
      occ('a', '2026-11-16T07:00:00Z', '2026-11-16T09:00:00Z'),
      occ('b', '2026-11-16T08:00:00Z', '2026-11-16T12:00:00Z'),
    ])
    expect(overlap).toHaveLength(1)
    expect(overlap[0].endsAt.toISOString()).toBe('2026-11-16T12:00:00.000Z')
  })

  it('keeps classes 31 minutes apart separate', () => {
    const sittings = buildSittings([
      occ('a', '2026-11-16T07:00:00Z', '2026-11-16T09:00:00Z'),
      occ('b', '2026-11-16T09:31:00Z', '2026-11-16T11:00:00Z'),
    ])
    expect(sittings).toHaveLength(2)
  })

  it('keeps different courses separate even when back to back', () => {
    const sittings = buildSittings([
      occ('a', '2026-11-16T07:00:00Z', '2026-11-16T09:00:00Z', null, 'c1'),
      occ('b', '2026-11-16T09:00:00Z', '2026-11-16T11:00:00Z', null, 'c2'),
    ])
    expect(sittings).toHaveLength(2)
    expect(sittings.map((s) => s.courseId).sort()).toEqual(['c1', 'c2'])
  })

  it('drops cancelled classes and splits around them', () => {
    const sittings = buildSittings([
      occ('a', '2026-11-16T07:00:00Z', '2026-11-16T09:00:00Z'),
      occ('b', '2026-11-16T09:00:00Z', '2026-11-16T10:00:00Z', 'cancelled'),
      occ('c', '2026-11-16T10:00:00Z', '2026-11-16T11:00:00Z'),
    ])
    expect(sittings.map((s) => s.key)).toEqual(['a', 'c'])
  })

  it('has a shared status only when every occurrence has it', () => {
    const shared = buildSittings([
      occ('a', '2026-11-16T07:00:00Z', '2026-11-16T09:00:00Z', 'taught'),
      occ('b', '2026-11-16T09:00:00Z', '2026-11-16T10:00:00Z', 'taught'),
    ])
    expect(shared[0].status).toBe('taught')
    const mixed = buildSittings([
      occ('a', '2026-11-16T07:00:00Z', '2026-11-16T09:00:00Z', 'taught'),
      occ('b', '2026-11-16T09:00:00Z', '2026-11-16T10:00:00Z', 'missed'),
    ])
    expect(mixed[0].status).toBeNull()
    const partial = buildSittings([
      occ('a', '2026-11-16T07:00:00Z', '2026-11-16T09:00:00Z', 'missed'),
      occ('b', '2026-11-16T09:00:00Z', '2026-11-16T10:00:00Z', null),
    ])
    expect(partial[0].status).toBeNull()
  })

  it('returns sittings sorted by start across courses', () => {
    const sittings = buildSittings([
      occ('z', '2026-11-16T12:00:00Z', '2026-11-16T13:00:00Z', null, 'c1'),
      occ('y', '2026-11-16T07:00:00Z', '2026-11-16T08:00:00Z', null, 'c2'),
    ])
    expect(sittings.map((s) => s.key)).toEqual(['y', 'z'])
  })
})

describe('parseOccurrenceKey', () => {
  it('round-trips both kinds and rejects junk', () => {
    expect(parseOccurrenceKey('slot:abc-123:2026-11-16')).toEqual({ kind: 'slot', slotId: 'abc-123', date: '2026-11-16' })
    expect(parseOccurrenceKey('extra:xyz')).toEqual({ kind: 'extra', extraId: 'xyz' })
    for (const bad of ['', 'slot:', 'slot:abc', 'slot:abc:2026-13-45x', 'slot::2026-11-16', 'extra:', 'foo:bar', 'extra:a:b']) {
      expect(parseOccurrenceKey(bad)).toBeNull()
    }
  })

  it('parses keys built by expandOccurrences', () => {
    const [o] = expand({ slots: [slot()], from: '2026-11-16', to: '2026-11-16' })
    expect(parseOccurrenceKey(o.key)).toEqual({ kind: 'slot', slotId: 's1', date: '2026-11-16' })
  })
})
