import type { Ctx } from '@/server/core/context'
import type { Db } from '@/server/db'
import { file } from '@/server/db/schema'
import { createCourse } from '@/server/courses/service'
import { setupCourse } from '@/test/marking-fixture'
import { createTopic } from './topics'

export const doc = (text: string) => [{ type: 'paragraph', content: [{ type: 'text', text, styles: {} }] }]

/** The marking fixture plus a topic in its course and a second course of the same lecturer with its own topic. */
export async function setupNotes(db: Db) {
  const fx = await setupCourse(db)
  const courseA = fx.bio.id
  const courseB = (await createCourse(fx.lecturer, { classId: fx.cls.id, title: 'Genetics', semester: 1 })).id
  const topicA = (await createTopic(fx.lecturer, courseA, { title: 'Cells' })).id
  const topicB = (await createTopic(fx.lecturer, courseB, { title: 'Genes' })).id
  return { ...fx, courseA, courseB, topicA, topicB }
}

/** A confirmed `resource` file row of `owner`, ready to be claimed. */
export async function insertResourceFile(db: Db, owner: Ctx, name = 'slides.pdf') {
  const id = crypto.randomUUID()
  await db.insert(file).values({
    id,
    ownerId: owner.user.id,
    purpose: 'resource',
    storageKey: `resources/${owner.user.id}/${id}-${name}`,
    name,
    mimeType: 'application/pdf',
    sizeBytes: 1000,
    confirmedAt: new Date(),
  })
  return id
}
