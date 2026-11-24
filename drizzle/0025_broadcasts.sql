CREATE TABLE "broadcast" (
	"id" text PRIMARY KEY NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"admin_id" text NOT NULL,
	"audience" text NOT NULL,
	"subject_en" text NOT NULL,
	"body_en" text NOT NULL,
	"subject_fr" text NOT NULL,
	"body_fr" text NOT NULL,
	"status" text DEFAULT 'sending' NOT NULL,
	"finished_at" timestamp with time zone,
	CONSTRAINT "broadcast_audience_check" CHECK ("broadcast"."audience" in ('lecturers', 'students', 'everyone')),
	CONSTRAINT "broadcast_status_check" CHECK ("broadcast"."status" in ('sending', 'done'))
);
--> statement-breakpoint
CREATE TABLE "broadcast_recipient" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"broadcast_id" text NOT NULL,
	"user_id" text,
	"email" text NOT NULL,
	"locale" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"error" text,
	"sent_at" timestamp with time zone,
	CONSTRAINT "broadcast_recipient_broadcast_user_unique" UNIQUE("broadcast_id","user_id"),
	CONSTRAINT "broadcast_recipient_locale_check" CHECK ("broadcast_recipient"."locale" in ('en', 'fr')),
	CONSTRAINT "broadcast_recipient_status_check" CHECK ("broadcast_recipient"."status" in ('pending', 'sending', 'sent', 'failed', 'skipped'))
);
--> statement-breakpoint
ALTER TABLE "admin_action" DROP CONSTRAINT "admin_action_action_check";--> statement-breakpoint
ALTER TABLE "admin_action" DROP CONSTRAINT "admin_action_one_target_check";--> statement-breakpoint
ALTER TABLE "user" ADD COLUMN "announcements_opt_out_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "user" ADD COLUMN "unsubscribe_token" text;--> statement-breakpoint
ALTER TABLE "broadcast" ADD CONSTRAINT "broadcast_admin_id_user_id_fk" FOREIGN KEY ("admin_id") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "broadcast_recipient" ADD CONSTRAINT "broadcast_recipient_broadcast_id_broadcast_id_fk" FOREIGN KEY ("broadcast_id") REFERENCES "public"."broadcast"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "broadcast_recipient" ADD CONSTRAINT "broadcast_recipient_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "broadcast_created_at_idx" ON "broadcast" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "broadcast_recipient_broadcast_status_idx" ON "broadcast_recipient" USING btree ("broadcast_id","status");--> statement-breakpoint
ALTER TABLE "user" ADD CONSTRAINT "user_unsubscribe_token_unique" UNIQUE("unsubscribe_token");--> statement-breakpoint
ALTER TABLE "admin_action" ADD CONSTRAINT "admin_action_action_check" CHECK ("admin_action"."action" in ('suspend', 'unsuspend', 'revoke_sessions', 'resend_verification', 'send_password_reset', 'school_update', 'school_delete', 'school_merge', 'broadcast_send'));--> statement-breakpoint
ALTER TABLE "admin_action" ADD CONSTRAINT "admin_action_one_target_check" CHECK (case when "admin_action"."action" = 'broadcast_send' then "admin_action"."target_user_id" is null and "admin_action"."target_school_id" is null else ("admin_action"."target_user_id" is null) <> ("admin_action"."target_school_id" is null) end);