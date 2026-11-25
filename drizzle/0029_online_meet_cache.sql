CREATE TABLE "class_meeting" (
	"occurrence_key" text PRIMARY KEY NOT NULL,
	"meeting_url" text NOT NULL,
	"calendar_event_id" text NOT NULL,
	"lecturer_email" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "class_extra" DROP CONSTRAINT "class_extra_online_campus_check";--> statement-breakpoint
ALTER TABLE "class_slot" DROP CONSTRAINT "class_slot_online_campus_check";--> statement-breakpoint
ALTER TABLE "class_extra" ADD COLUMN "auto_meet" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "class_slot" ADD COLUMN "auto_meet" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "class_extra" ADD CONSTRAINT "class_extra_online_campus_check" CHECK (("class_extra"."meeting_url" is null and "class_extra"."auto_meet" = false) or "class_extra"."require_on_campus" = false);--> statement-breakpoint
ALTER TABLE "class_slot" ADD CONSTRAINT "class_slot_online_campus_check" CHECK (("class_slot"."meeting_url" is null and "class_slot"."auto_meet" = false) or "class_slot"."require_on_campus" = false);