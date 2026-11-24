CREATE TABLE "online_class_join" (
	"occurrence_key" text NOT NULL,
	"student_id" text NOT NULL,
	"first_joined_at" timestamp with time zone NOT NULL,
	"last_joined_at" timestamp with time zone NOT NULL,
	CONSTRAINT "online_class_join_occurrence_key_student_id_pk" PRIMARY KEY("occurrence_key","student_id")
);
--> statement-breakpoint
ALTER TABLE "class_extra" ADD COLUMN "meeting_url" text;--> statement-breakpoint
ALTER TABLE "class_slot" ADD COLUMN "meeting_url" text;--> statement-breakpoint
ALTER TABLE "online_class_join" ADD CONSTRAINT "online_class_join_student_id_user_id_fk" FOREIGN KEY ("student_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "class_extra" ADD CONSTRAINT "class_extra_online_campus_check" CHECK ("class_extra"."meeting_url" is null or "class_extra"."require_on_campus" = false);--> statement-breakpoint
ALTER TABLE "class_slot" ADD CONSTRAINT "class_slot_online_campus_check" CHECK ("class_slot"."meeting_url" is null or "class_slot"."require_on_campus" = false);