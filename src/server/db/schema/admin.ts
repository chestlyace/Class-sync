import { sql } from 'drizzle-orm'
import { boolean, check, index, jsonb, pgTable, text, timestamp } from 'drizzle-orm/pg-core'
import { user } from './auth'

export const ADMIN_ACTIONS = ['suspend', 'unsuspend', 'revoke_sessions', 'resend_verification'] as const
export type AdminActionKind = (typeof ADMIN_ACTIONS)[number]

export const OPS_EVENT_KINDS = ['cron_reminders', 'email_sent', 'email_failed', 'mcp_request', 'push_sent', 'push_failed'] as const
export type OpsEventKind = (typeof OPS_EVENT_KINDS)[number]

/** Audit trail of what an admin did to which account. Rows are never deleted with their users. */
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
    targetUserId: text('target_user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'restrict' }),
    reason: text('reason'),
  },
  (t) => [
    check('admin_action_action_check', sql`${t.action} in ('suspend', 'unsuspend', 'revoke_sessions', 'resend_verification')`),
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
    check('ops_event_kind_check', sql`${t.kind} in ('cron_reminders', 'email_sent', 'email_failed', 'mcp_request', 'push_sent', 'push_failed')`),
    index('ops_event_kind_at_idx').on(t.kind, t.at),
  ],
)
