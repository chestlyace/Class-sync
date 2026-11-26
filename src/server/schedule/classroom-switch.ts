import type { SessionUser } from '@/server/core/context'
import { type Env, isAdmin } from '@/server/core/admin'

export type ClassroomMode = 'off' | 'admins' | 'everyone'

/** MEET_CLASSROOM: `admins` or `everyone`; unset or any other value is `off`. */
export function classroomMode(env: Env = process.env): ClassroomMode {
  const value = env.MEET_CLASSROOM?.trim().toLowerCase()
  return value === 'admins' || value === 'everyone' ? value : 'off'
}

/** Whether this user may use course classrooms (Google Meet rooms Clasync creates for their courses). */
export function canUseClassroom(user: SessionUser, env: Env = process.env): boolean {
  if (user.role !== 'lecturer') return false
  const mode = classroomMode(env)
  if (mode === 'everyone') return true
  return mode === 'admins' && isAdmin(user, env)
}
