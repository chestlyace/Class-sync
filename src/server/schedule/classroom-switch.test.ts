import { describe, expect, it } from 'vitest'
import type { SessionUser } from '@/server/core/context'
import { canUseClassroom, classroomMode } from './classroom-switch'

function user(over: Partial<SessionUser> = {}): SessionUser {
  return {
    id: 'u1',
    name: 'Test',
    email: 'lecturer@example.com',
    role: 'lecturer',
    locale: 'en',
    emailVerified: true,
    phoneNumberVerified: false,
    ...over,
  }
}

describe('classroomMode', () => {
  it('is off when unset', () => {
    expect(classroomMode({})).toBe('off')
  })

  it('reads admins and everyone', () => {
    expect(classroomMode({ MEET_CLASSROOM: 'admins' })).toBe('admins')
    expect(classroomMode({ MEET_CLASSROOM: 'everyone' })).toBe('everyone')
  })

  it('treats any other value as off', () => {
    expect(classroomMode({ MEET_CLASSROOM: 'yes' })).toBe('off')
    expect(classroomMode({ MEET_CLASSROOM: '' })).toBe('off')
  })
})

describe('canUseClassroom', () => {
  const admin = user({ email: 'boss@example.com' })
  const env = (mode?: string) => ({ ADMIN_EMAILS: 'boss@example.com', MEET_CLASSROOM: mode })

  it('is never open to students', () => {
    const student = user({ role: 'student', email: 'boss@example.com' })
    expect(canUseClassroom(student, env('everyone'))).toBe(false)
    expect(canUseClassroom(student, env('admins'))).toBe(false)
  })

  it('is closed for everyone when off', () => {
    expect(canUseClassroom(user(), env())).toBe(false)
    expect(canUseClassroom(admin, env('off'))).toBe(false)
  })

  it('is open to admin lecturers only under admins', () => {
    expect(canUseClassroom(user(), env('admins'))).toBe(false)
    expect(canUseClassroom(admin, env('admins'))).toBe(true)
  })

  it('is open to every lecturer under everyone', () => {
    expect(canUseClassroom(user(), env('everyone'))).toBe(true)
    expect(canUseClassroom(admin, env('everyone'))).toBe(true)
  })
})
