CREATE TABLE "push_cooldown" (
	"key" text PRIMARY KEY NOT NULL,
	"until" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "push_subscription" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"endpoint" text NOT NULL,
	"p256dh" text NOT NULL,
	"auth" text NOT NULL,
	"label" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_success_at" timestamp with time zone,
	"failure_count" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "push_subscription_endpoint_unique" UNIQUE("endpoint")
);
--> statement-breakpoint
ALTER TABLE "ops_event" DROP CONSTRAINT "ops_event_kind_check";--> statement-breakpoint
ALTER TABLE "push_subscription" ADD CONSTRAINT "push_subscription_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "push_subscription_user_id_idx" ON "push_subscription" USING btree ("user_id");--> statement-breakpoint
ALTER TABLE "ops_event" ADD CONSTRAINT "ops_event_kind_check" CHECK ("ops_event"."kind" in ('cron_reminders', 'email_sent', 'email_failed', 'mcp_request', 'push_sent', 'push_failed'));