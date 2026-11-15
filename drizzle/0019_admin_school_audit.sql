ALTER TABLE "admin_action" DROP CONSTRAINT "admin_action_action_check";--> statement-breakpoint
ALTER TABLE "admin_action" ALTER COLUMN "target_user_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "admin_action" ADD COLUMN "target_school_id" text;--> statement-breakpoint
ALTER TABLE "admin_action" ADD COLUMN "details" jsonb;--> statement-breakpoint
ALTER TABLE "admin_action" ADD CONSTRAINT "admin_action_one_target_check" CHECK (("admin_action"."target_user_id" is null) <> ("admin_action"."target_school_id" is null));--> statement-breakpoint
ALTER TABLE "admin_action" ADD CONSTRAINT "admin_action_action_check" CHECK ("admin_action"."action" in ('suspend', 'unsuspend', 'revoke_sessions', 'resend_verification', 'school_update', 'school_delete', 'school_merge'));