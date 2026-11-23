import { eq } from 'drizzle-orm'
import type { Ctx, Locale } from '@/server/core/context'
import type { Db } from '@/server/db'
import { caTemplate, caTemplateDefault, type CaTemplateSettingsDb } from '@/server/db/schema'
import { builtInSettings, isBuiltInTemplateId, validateSettings, type CaSettings } from './rules'
import { settingsError, writeCourseCa } from './write'

/*
 * Template helpers with no dependency on the course services, so creating a course can apply
 * the lecturer's default template (templates.ts holds the rest).
 */

/** "CA 1" or "CC 1": a built-in template's named CAs, in the user's language. */
export function groupNameFor(locale: Locale): (n: number) => string {
  return (n) => (locale === 'fr' ? `CC ${n}` : `CA ${n}`)
}

/** A template as stored: course settings without the named CAs' ids. */
export function toStored(s: CaSettings): CaTemplateSettingsDb {
  return {
    total: s.total,
    attendancePoints: s.attendancePoints,
    assignmentPoints: s.assignmentPoints,
    participationPoints: s.participationPoints,
    testPoints: s.testPoints,
    participationTarget: s.participationTarget,
    testsBestOf: s.testsBestOf,
    groups: s.groups.map((g) => ({ name: g.name, points: g.points, bestOf: g.bestOf })),
  }
}

/** A stored template as settings to write; checked again, so a template the rules now refuse is never applied. */
export function fromStored(stored: CaTemplateSettingsDb): CaSettings {
  const parsed = validateSettings({ ...stored, groups: stored.groups.map((g) => ({ ...g, id: null })) })
  if ('error' in parsed) throw settingsError(parsed)
  return parsed
}

/**
 * Sets up a course I just created with my default template, if I chose one. A template that no
 * longer passes the rules is skipped: the course keeps the app's defaults.
 */
export async function applyDefaultCaTemplate(db: Db, user: Ctx['user'], courseId: string): Promise<void> {
  const [def] = await db.select().from(caTemplateDefault).where(eq(caTemplateDefault.userId, user.id))
  if (!def) return
  let settings: CaSettings | null = null
  if (def.builtInId && isBuiltInTemplateId(def.builtInId)) {
    settings = builtInSettings(def.builtInId, groupNameFor(user.locale))
  } else if (def.templateId) {
    const [row] = await db.select({ settings: caTemplate.settings }).from(caTemplate).where(eq(caTemplate.id, def.templateId))
    if (row) {
      try {
        settings = fromStored(row.settings)
      } catch {
        settings = null
      }
    }
  }
  if (settings) await writeCourseCa(db, courseId, settings, user.id)
}
