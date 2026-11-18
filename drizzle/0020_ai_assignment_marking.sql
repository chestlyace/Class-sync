CREATE TABLE "ai_usage" (
	"id" text PRIMARY KEY NOT NULL,
	"purpose" text NOT NULL,
	"lecturer_id" text NOT NULL,
	"submission_id" text,
	"model" text NOT NULL,
	"input_tokens" integer DEFAULT 0 NOT NULL,
	"output_tokens" integer DEFAULT 0 NOT NULL,
	"ok" boolean NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ai_usage_purpose_check" CHECK ("ai_usage"."purpose" in ('assignment_marking'))
);
--> statement-breakpoint
ALTER TABLE "assignment" ADD COLUMN "marking_guide" text;--> statement-breakpoint
ALTER TABLE "submission" ADD COLUMN "suggested_by" text;--> statement-breakpoint
ALTER TABLE "submission" ADD COLUMN "suggested_transcript" text;--> statement-breakpoint
ALTER TABLE "submission" ADD COLUMN "suggested_unread" jsonb;--> statement-breakpoint
ALTER TABLE "submission" ADD COLUMN "ai_status" text;--> statement-breakpoint
ALTER TABLE "submission" ADD COLUMN "ai_status_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "submission" ADD COLUMN "ai_error" text;--> statement-breakpoint
ALTER TABLE "ai_usage" ADD CONSTRAINT "ai_usage_lecturer_id_user_id_fk" FOREIGN KEY ("lecturer_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_usage" ADD CONSTRAINT "ai_usage_submission_id_submission_id_fk" FOREIGN KEY ("submission_id") REFERENCES "public"."submission"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ai_usage_created_at_idx" ON "ai_usage" USING btree ("created_at");--> statement-breakpoint
ALTER TABLE "submission" ADD CONSTRAINT "submission_suggested_by_check" CHECK ("submission"."suggested_by" in ('assistant', 'clasync'));--> statement-breakpoint
ALTER TABLE "submission" ADD CONSTRAINT "submission_ai_status_check" CHECK ("submission"."ai_status" in ('queued', 'failed'));--> statement-breakpoint
ALTER TABLE "submission" ADD CONSTRAINT "submission_ai_error_check" CHECK ("submission"."ai_error" in ('provider', 'cap', 'unreadable'));