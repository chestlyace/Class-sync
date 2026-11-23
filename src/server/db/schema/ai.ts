import { sql } from 'drizzle-orm'
import { boolean, check, index, integer, pgTable, text, timestamp } from 'drizzle-orm/pg-core'
import { submission } from './assignment'
import { user } from './auth'

export const AI_USAGE_PURPOSES = ['assignment_marking', 'test_correction'] as const
export type AiUsagePurpose = (typeof AI_USAGE_PURPOSES)[number]

/** One row per model call Clasync pays for, so the monthly cap and cost can be counted. */
export const aiUsage = pgTable(
  'ai_usage',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    purpose: text('purpose', { enum: AI_USAGE_PURPOSES }).notNull(),
    lecturerId: text('lecturer_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    submissionId: text('submission_id').references(() => submission.id, { onDelete: 'set null' }),
    model: text('model').notNull(),
    inputTokens: integer('input_tokens').notNull().default(0),
    outputTokens: integer('output_tokens').notNull().default(0),
    ok: boolean('ok').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check('ai_usage_purpose_check', sql`${t.purpose} in ('assignment_marking', 'test_correction')`),
    index('ai_usage_created_at_idx').on(t.createdAt),
    index('ai_usage_submission_id_idx').on(t.submissionId),
  ],
)
