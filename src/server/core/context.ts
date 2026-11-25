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
  /** A WhatsApp code proved the account's number. `emailVerified` keeps meaning "email proven". */
  phoneNumberVerified: boolean
}

export type Ctx = { db: Db; user: SessionUser }
