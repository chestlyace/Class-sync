import { sql } from 'drizzle-orm'
import { boolean, check, index, integer, jsonb, pgTable, primaryKey, text, timestamp } from 'drizzle-orm/pg-core'
import { user } from './auth'
import { file } from './assignment'
import { course } from './course'

export const RESOURCE_KINDS = ['note', 'file', 'link'] as const
export type ResourceKind = (typeof RESOURCE_KINDS)[number]

/** A lecturer's heading for material in one course; each course keeps its own order and visibility. */
export const courseTopic = pgTable(
  'course_topic',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    courseId: text('course_id')
      .notNull()
      .references(() => course.id, { onDelete: 'cascade' }),
    title: text('title').notNull(),
    position: integer('position').notNull(),
    hidden: boolean('hidden').notNull().default(false),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('course_topic_course_id_position_idx').on(t.courseId, t.position)],
)

/** A note, a file or a link; shared between courses through `resource_placement`. */
export const resource = pgTable(
  'resource',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    ownerId: text('owner_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    kind: text('kind', { enum: RESOURCE_KINDS }).notNull(),
    title: text('title').notNull(),
    body: jsonb('body'),
    bodyText: text('body_text'),
    url: text('url'),
    // The services delete the resource row before the stored file.
    fileId: text('file_id')
      .unique()
      .references(() => file.id, { onDelete: 'restrict' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check('resource_kind_check', sql`${t.kind} in ('note', 'file', 'link')`),
    check('resource_link_url_check', sql`(${t.kind} = 'link') = (${t.url} is not null)`),
    check('resource_file_file_id_check', sql`(${t.kind} = 'file') = (${t.fileId} is not null)`),
    index('resource_owner_id_idx').on(t.ownerId),
  ],
)

export const resourcePlacement = pgTable(
  'resource_placement',
  {
    resourceId: text('resource_id')
      .notNull()
      .references(() => resource.id, { onDelete: 'cascade' }),
    courseId: text('course_id')
      .notNull()
      .references(() => course.id, { onDelete: 'cascade' }),
    // A topic is only deleted once it is empty.
    topicId: text('topic_id')
      .notNull()
      .references(() => courseTopic.id, { onDelete: 'restrict' }),
    position: integer('position').notNull(),
    addedAt: timestamp('added_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.resourceId, t.courseId] }),
    index('resource_placement_topic_id_position_idx').on(t.topicId, t.position),
    index('resource_placement_course_id_idx').on(t.courseId),
  ],
)

export const resourceView = pgTable(
  'resource_view',
  {
    resourceId: text('resource_id')
      .notNull()
      .references(() => resource.id, { onDelete: 'cascade' }),
    studentId: text('student_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    viewedAt: timestamp('viewed_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.resourceId, t.studentId] }), index('resource_view_student_id_idx').on(t.studentId)],
)
