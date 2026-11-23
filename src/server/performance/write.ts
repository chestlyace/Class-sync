import { eq } from 'drizzle-orm'
import { AppError } from '@/server/core/errors'
import { now } from '@/server/core/clock'
import type { Db } from '@/server/db'
import { caTestGroup, courseCaSettings } from '@/server/db/schema'
import type { CaGroup, CaSettings } from './rules'

export function settingsError(parsed: { error: string }): AppError {
  return new AppError('VALIDATION', `Invalid CA settings: ${parsed.error}`, { reason: parsed.error })
}

/**
 * Writes already-validated settings and named CAs for a course, in one transaction. A named CA
 * keeps its id (so its tests stay in it) when it comes with that id, or, without one, when an
 * existing one has the same name (case ignored): applying a template keeps "CA 1" as it was.
 * Named CAs left out are deleted; their tests then count in the first one (see `groupOfTest`).
 * An id that isn't one of the course's is refused (VALIDATION shape).
 */
export async function writeCourseCa(db: Db, courseId: string, settings: CaSettings, userId: string): Promise<CaSettings> {
  return db.transaction(async (tx) => {
    const existing = await tx
      .select({ id: caTestGroup.id, name: caTestGroup.name })
      .from(caTestGroup)
      .where(eq(caTestGroup.courseId, courseId))
    const byId = new Map(existing.map((g) => [g.id, g]))
    // Ids given explicitly are claimed first, so a same-name match never takes one of them.
    const used = new Set<string>()
    for (const g of settings.groups) {
      if (g.id === null) continue
      if (!byId.has(g.id) || used.has(g.id)) throw settingsError({ error: 'shape' })
      used.add(g.id)
    }
    const plan: (CaGroup & { id: string; isNew: boolean })[] = settings.groups.map((g) => {
      if (g.id !== null) return { ...g, id: g.id, isNew: false }
      const same = existing.find((e) => !used.has(e.id) && e.name.toLowerCase() === g.name.toLowerCase())
      if (same) used.add(same.id)
      return { ...g, id: same?.id ?? crypto.randomUUID(), isNew: !same }
    })

    for (const e of existing) if (!used.has(e.id)) await tx.delete(caTestGroup).where(eq(caTestGroup.id, e.id))
    // Names are unique per course: park the kept ones first, so two can swap names.
    for (const g of plan) {
      if (!g.isNew) await tx.update(caTestGroup).set({ name: `~moving~${g.id}` }).where(eq(caTestGroup.id, g.id))
    }
    for (const [position, g] of plan.entries()) {
      const values = { name: g.name, points: g.points, bestOf: g.bestOf, position }
      if (g.isNew) await tx.insert(caTestGroup).values({ id: g.id, courseId, ...values })
      else await tx.update(caTestGroup).set(values).where(eq(caTestGroup.id, g.id))
    }

    const values = {
      total: settings.total,
      attendancePoints: settings.attendancePoints,
      assignmentPoints: settings.assignmentPoints,
      participationPoints: settings.participationPoints,
      testPoints: settings.testPoints,
      participationTarget: settings.participationTarget,
      testsBestOf: settings.testsBestOf,
      updatedBy: userId,
      updatedAt: now(),
    }
    await tx
      .insert(courseCaSettings)
      .values({ courseId, ...values })
      .onConflictDoUpdate({ target: courseCaSettings.courseId, set: values })
    return { ...settings, groups: plan.map(({ id, name, points, bestOf }) => ({ id, name, points, bestOf })) }
  })
}
