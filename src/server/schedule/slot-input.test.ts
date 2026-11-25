import { describe, expect, it } from 'vitest'
import { parseMakeUpInput, parseOnlineFields, parseSlotInput } from './slot-input'

const slot = {
  weekday: 1,
  startMinute: 480,
  endMinute: 600,
  room: '  B2  ',
  requireOnCampus: false,
  meetingUrl: '  https://meet.google.com/abc-defg-hij  ',
  startsOn: '2026-11-01',
  endsOn: '2026-12-31',
}

describe('online slot input', () => {
  it('normalises a pasted Meet URL and trims the room', () => {
    expect(parseSlotInput(slot)).toMatchObject({
      room: 'B2',
      meetingUrl: 'https://meet.google.com/abc-defg-hij',
      autoMeet: false,
    })
  })

  it('accepts generated links only when no URL is pasted', () => {
    expect(parseSlotInput({ ...slot, meetingUrl: null, autoMeet: true })).toMatchObject({
      meetingUrl: null,
      autoMeet: true,
    })
    expect(() => parseSlotInput({ ...slot, autoMeet: true })).toThrow(
      expect.objectContaining({ details: { fields: ['meetingUrl', 'autoMeet'], reason: 'two_meeting_modes' } }),
    )
  })

  it('never allows an online class to require campus check-in', () => {
    expect(() => parseOnlineFields({ meetingUrl: null, autoMeet: true, requireOnCampus: true })).toThrow(
      expect.objectContaining({ details: { fields: ['requireOnCampus'], reason: 'online_and_campus' } }),
    )
    expect(() => parseMakeUpInput({ ...slot, date: '2026-11-16', requireOnCampus: true })).toThrow(
      expect.objectContaining({ code: 'VALIDATION' }),
    )
  })

  it('validates the term and the class length', () => {
    expect(() => parseSlotInput({ ...slot, startMinute: 600 })).toThrow(
      expect.objectContaining({ details: { fields: ['endMinute'] } }),
    )
    expect(() => parseSlotInput({ ...slot, endsOn: '2026-10-31' })).toThrow(
      expect.objectContaining({ details: { fields: ['endsOn'] } }),
    )
  })
})
