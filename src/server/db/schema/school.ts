import { doublePrecision, integer, pgTable, text, timestamp, unique } from 'drizzle-orm/pg-core'
import { user } from './auth'

export const school = pgTable(
  'school',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    name: text('name').notNull(),
    town: text('town').notNull(),
    // Lowercased, whitespace-collapsed copies used for duplicate detection.
    nameKey: text('name_key').notNull(),
    townKey: text('town_key').notNull(),
    latitude: doublePrecision('latitude'),
    longitude: doublePrecision('longitude'),
    radiusM: integer('radius_m').notNull().default(500),
    createdBy: text('created_by')
      .notNull()
      .references(() => user.id),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [unique('school_name_key_town_key_unique').on(t.nameKey, t.townKey)],
)
