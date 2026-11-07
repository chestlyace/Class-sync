import type { Db } from '../db'

export type Role = 'lecturer' | 'student'
export type Locale = 'en' | 'fr'

export type SessionUser = {
  id: string
  name: string
  email: string
  role: Role
  locale: Locale
  emailVerified: boolean
}

export type Ctx = { db: Db; user: SessionUser }
