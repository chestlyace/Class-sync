CREATE TABLE "course_classroom" (
	"course_id" text PRIMARY KEY NOT NULL,
	"space_name" text NOT NULL,
	"meeting_url" text NOT NULL,
	"meeting_code" text NOT NULL,
	"google_account_id" text NOT NULL,
	"knocking_confirmed" boolean NOT NULL,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DROP TABLE "class_meeting" CASCADE;--> statement-breakpoint
ALTER TABLE "course_classroom" ADD CONSTRAINT "course_classroom_course_id_course_id_fk" FOREIGN KEY ("course_id") REFERENCES "public"."course"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "course_classroom" ADD CONSTRAINT "course_classroom_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;