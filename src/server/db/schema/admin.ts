import { sql } from 'drizzle-orm'
import { boolean, check, index, jsonb, pgTable, text, timestamp } from 'drizzle-orm/pg-core'
import { user } from './auth'

export const ADMIN_ACTIONS = [
  'suspend',
  'unsuspend',
  'revoke_sessions',
  'resend_verification',
  'send_password_reset',
  'school_update',
  'school_delete',
  'school_merge',
] as const
export type AdminActionKind = (typeof ADMIN_ACTIONS)[number]

export type SchoolRef = { id: string; name: string; town: string }

/** What a school action changed, kept by value so the row still reads once the school is gone. */
export type AdminActionDetails =
  | { kind: 'school_update'; before: { name: string; town: string }; after: { name: string; town: string } }
  | { kind: 'school_delete'; school: SchoolRef; classes: number; courses: number; students: number }
  | { kind: 'school_merge'; from: SchoolRef; into: SchoolRef; classesMoved: number }

export const OPS_EVENT_KINDS = ['cron_reminders', 'cron_schedule', 'email_sent', 'email_failed', 'mcp_request', 'push_sent', 'push_failed'] as const
export type OpsEventKind = (typeof OPS_EVENT_KINDS)[number]

/**
 * Audit trail of what an admin did to which account or school. Rows are never deleted with their
 * users; a school row has no foreign key, since a deleted or merged school is gone afterwards.
 */
export const adminAction = pgTable(
  'admin_action',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    at: timestamp('at', { withTimezone: true }).notNull().defaultNow(),
    adminId: text('admin_id')
      .notNull()
      .references(() => user.id, { onDelete: 'restrict' }),
    action: text('action', { enum: ADMIN_ACTIONS }).notNull(),
    targetUserId: text('target_user_id').references(() => user.id, { onDelete: 'restrict' }),
    targetSchoolId: text('target_school_id'),
    details: jsonb('details').$type<AdminActionDetails>(),
    reason: text('reason'),
  },
  (t) => [
    check(
      'admin_action_action_check',
      sql`${t.action} in ('suspend', 'unsuspend', 'revoke_sessions', 'resend_verification', 'send_password_reset', 'school_update', 'school_delete', 'school_merge')`,
    ),
    check('admin_action_one_target_check', sql`(${t.targetUserId} is null) <> (${t.targetSchoolId} is null)`),
    index('admin_action_at_idx').on(t.at),
  ],
)

/** Operational telemetry (cron runs, emails, MCP requests) for the admin health view. */
export const opsEvent = pgTable(
  'ops_event',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    at: timestamp('at', { withTimezone: true }).notNull().defaultNow(),
    kind: text('kind', { enum: OPS_EVENT_KINDS }).notNull(),
    ok: boolean('ok').notNull(),
    detail: jsonb('detail').notNull().default({}),
  },
  (t) => [
    check('ops_event_kind_check', sql`${t.kind} in ('cron_reminders', 'cron_schedule', 'email_sent', 'email_failed', 'mcp_request', 'push_sent', 'push_failed')`),
    index('ops_event_kind_at_idx').on(t.kind, t.at),
  ],
)
