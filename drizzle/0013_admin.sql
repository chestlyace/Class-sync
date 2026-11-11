CREATE TABLE "admin_action" (
	"id" text PRIMARY KEY NOT NULL,
	"at" timestamp with time zone DEFAULT now() NOT NULL,
	"admin_id" text NOT NULL,
	"action" text NOT NULL,
	"target_user_id" text NOT NULL,
	"reason" text,
	CONSTRAINT "admin_action_action_check" CHECK ("admin_action"."action" in ('suspend', 'unsuspend', 'revoke_sessions', 'resend_verification'))
);
--> statement-breakpoint
CREATE TABLE "ops_event" (
	"id" text PRIMARY KEY NOT NULL,
	"at" timestamp with time zone DEFAULT now() NOT NULL,
	"kind" text NOT NULL,
	"ok" boolean NOT NULL,
	"detail" jsonb DEFAULT '{}'::jsonb NOT NULL,
	CONSTRAINT "ops_event_kind_check" CHECK ("ops_event"."kind" in ('cron_reminders', 'email_sent', 'email_failed', 'mcp_request'))
);
--> statement-breakpoint
ALTER TABLE "user" ADD COLUMN "last_sign_in_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "user" ADD COLUMN "last_seen_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "user" ADD COLUMN "suspended_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "user" ADD COLUMN "suspended_reason" text;--> statement-breakpoint
ALTER TABLE "admin_action" ADD CONSTRAINT "admin_action_admin_id_user_id_fk" FOREIGN KEY ("admin_id") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "admin_action" ADD CONSTRAINT "admin_action_target_user_id_user_id_fk" FOREIGN KEY ("target_user_id") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "admin_action_at_idx" ON "admin_action" USING btree ("at");--> statement-breakpoint
CREATE INDEX "ops_event_kind_at_idx" ON "ops_event" USING btree ("kind","at");--> statement-breakpoint
CREATE INDEX "user_suspended_at_idx" ON "user" USING btree ("suspended_at") WHERE "user"."suspended_at" is not null;