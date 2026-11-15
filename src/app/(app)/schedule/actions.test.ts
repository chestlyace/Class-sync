import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Ctx } from '@/server/core/context'
import { weekStartOf } from '@/server/lib/local-time'

const ctx = { user: { id: 'lecturer-1', role: 'lecturer' } } as unknown as Ctx
vi.mock('@/server/auth/session', () => ({ getCtx: async () => ctx }))
const revalidatePath = vi.fn()
vi.mock('next/cache', () => ({ revalidatePath: (...args: unknown[]) => revalidatePath(...args) }))

const createSlot = vi.fn()
const updateSlot = vi.fn()
const removeSlot = vi.fn()
vi.mock('@/server/schedule/timetable', () => ({
  createSlot: (...args: unknown[]) => createSlot(...args),
  updateSlot: (...args: unknown[]) => updateSlot(...args),
  removeSlot: (...args: unknown[]) => removeSlot(...args),
}))
const cancelClass = vi.fn()
const undoCancel = vi.fn()
const addMakeUp = vi.fn()
const answerSitting = vi.fn()
vi.mock('@/server/schedule/changes', () => ({
  cancelClass: (...args: unknown[]) => cancelClass(...args),
  undoCancel: (...args: unknown[]) => undoCancel(...args),
  addMakeUp: (...args: unknown[]) => addMakeUp(...args),
  answerSitting: (...args: unknown[]) => answerSitting(...args),
}))
const startClassAttendance = vi.fn()
vi.mock('@/server/schedule/views', () => ({
  startClassAttendance: (...args: unknown[]) => startClassAttendance(...args),
}))

import {
  addMakeUpAction,
  answerSittingAction,
  cancelClassAction,
  createSlotAction,
  startClassAttendanceAction,
  updateSlotAction,
} from './actions'
import { parseWeekParam } from './schedule-form'

function form(fields: Record<string, string>): FormData {
  const data = new FormData()
  for (const [key, value] of Object.entries(fields)) data.set(key, value)
  return data
}

const slotFields = {
  weekday: '1',
  startMinute: '08:00',
  endMinute: '12:30',
  room: 'B4',
  startsOn: '2026-09-07',
  endsOn: '2027-01-15',
}

describe('schedule Server Actions', () => {
  beforeEach(() => {
    for (const fn of [createSlot, updateSlot, removeSlot, cancelClass, undoCancel, addMakeUp, answerSitting]) {
      fn.mockReset()
    }
    startClassAttendance.mockReset()
    revalidatePath.mockReset()
  })
  afterEach(() => vi.restoreAllMocks())

  it('reads HH:MM times as minutes and an unchecked box as false when adding a slot', async () => {
    const overlaps = [
      {
        courseId: 'c2',
        courseTitle: 'Databases',
        className: 'HND1',
        schoolName: 'ISTA',
        weekday: 1,
        startMinute: 600,
        endMinute: 720,
      },
    ]
    createSlot.mockResolvedValue({ slot: { id: 's1' }, overlaps })

    expect(await createSlotAction('c1', form(slotFields))).toEqual({ ok: true, data: { overlaps } })
    expect(createSlot).toHaveBeenCalledWith(ctx, 'c1', {
      weekday: 1,
      startMinute: 480,
      endMinute: 750,
      room: 'B4',
      requireOnCampus: false,
      startsOn: '2026-09-07',
      endsOn: '2027-01-15',
    })
    expect(revalidatePath).toHaveBeenCalled()
  })

  it('reads a checked box as true when editing a slot', async () => {
    updateSlot.mockResolvedValue({ slot: { id: 's2' }, overlaps: [] })

    const result = await updateSlotAction('s1', form({ ...slotFields, startMinute: '23:05', requireOnCampus: 'on' }))
    expect(result).toEqual({ ok: true, data: { overlaps: [] } })
    expect(updateSlot).toHaveBeenCalledWith(
      ctx,
      's1',
      expect.objectContaining({ startMinute: 1385, requireOnCampus: true }),
    )
  })

  it('refuses a time that is not HH:MM, naming the field, without calling the service', async () => {
    for (const bad of ['8am', '24:00', '07:60', '', '7:5']) {
      expect(await createSlotAction('c1', form({ ...slotFields, endMinute: bad }))).toEqual({
        ok: false,
        code: 'VALIDATION',
        details: { fields: ['endMinute'] },
      })
    }
    expect(await createSlotAction('c1', form({ ...slotFields, weekday: '8' }))).toMatchObject({
      ok: false,
      details: { fields: ['weekday'] },
    })
    expect(createSlot).not.toHaveBeenCalled()
  })

  it('cancels without a make-up unless the make-up box is ticked', async () => {
    expect(await cancelClassAction('slot:a:2026-11-16', form({ date: '2026-11-18', startMinute: '10:00' }))).toEqual(
      { ok: true, data: null },
    )
    expect(cancelClass).toHaveBeenCalledWith(ctx, 'slot:a:2026-11-16', undefined)

    const makeUp = { makeUp: 'on', date: '2026-11-18', startMinute: '10:00', endMinute: '12:00', room: '' }
    expect(await cancelClassAction('slot:a:2026-11-16', form(makeUp))).toEqual({ ok: true, data: null })
    expect(cancelClass).toHaveBeenLastCalledWith(ctx, 'slot:a:2026-11-16', {
      date: '2026-11-18',
      startMinute: 600,
      endMinute: 720,
      room: '',
      requireOnCampus: false,
    })
  })

  it('adds a make-up class, replacing a sitting only when one is given', async () => {
    addMakeUp.mockResolvedValue({ key: 'extra:x' })
    const fields = { date: '2026-11-20', startMinute: '13:00', endMinute: '15:00', room: 'A1' }

    expect(await addMakeUpAction('c1', form(fields))).toEqual({ ok: true, data: null })
    expect(addMakeUp).toHaveBeenCalledWith(ctx, 'c1', {
      date: '2026-11-20',
      startMinute: 780,
      endMinute: 900,
      room: 'A1',
      requireOnCampus: false,
    })

    await addMakeUpAction('c1', form({ ...fields, requireOnCampus: 'on', replaces: 'slot:a:2026-11-02' }))
    expect(addMakeUp).toHaveBeenLastCalledWith(ctx, 'c1', {
      date: '2026-11-20',
      startMinute: 780,
      endMinute: 900,
      room: 'A1',
      requireOnCampus: true,
      replaces: 'slot:a:2026-11-02',
    })
  })

  it('answers a sitting only with taught or missed', async () => {
    expect(await answerSittingAction('slot:a:2026-11-02', 'missed')).toEqual({ ok: true, data: null })
    expect(answerSitting).toHaveBeenCalledWith(ctx, 'slot:a:2026-11-02', 'missed')
    expect(await answerSittingAction('slot:a:2026-11-02', 'maybe')).toMatchObject({ ok: false, code: 'VALIDATION' })
    expect(answerSitting).toHaveBeenCalledTimes(1)
  })

  it('opens check-in and goes to the attendance session', async () => {
    startClassAttendance.mockResolvedValue({ courseId: 'c1', sessionId: 'sess-1' })
    await expect(startClassAttendanceAction('slot:a:2026-11-13')).rejects.toMatchObject({
      digest: expect.stringContaining('/courses/c1/attendance/sess-1'),
    })
    expect(startClassAttendance).toHaveBeenCalledWith(ctx, 'slot:a:2026-11-13')
  })
})

describe('parseWeekParam', () => {
  const today = '2026-11-13' // a Friday
  const current = weekStartOf(today)

  it('falls back to the current week for anything missing or invalid', () => {
    expect(current).toBe('2026-11-09')
    for (const bad of [undefined, '', 'next', '2026-13-01', '2026-02-30', '20261109', ['2026-11-16', '2026-11-23']]) {
      expect(parseWeekParam(bad, today)).toBe(current)
    }
  })

  it('always returns the Monday of the asked week', () => {
    expect(parseWeekParam('2026-11-16', today)).toBe('2026-11-16')
    expect(parseWeekParam('2026-11-19', today)).toBe('2026-11-16')
    expect(parseWeekParam('2026-11-01', today)).toBe('2026-10-26')
  })
})
