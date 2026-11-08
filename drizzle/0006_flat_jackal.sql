CREATE TABLE "course_ca_settings" (
	"course_id" text PRIMARY KEY NOT NULL,
	"total" numeric(6, 2) NOT NULL,
	"attendance_points" numeric(6, 2) NOT NULL,
	"assignment_points" numeric(6, 2) NOT NULL,
	"participation_points" numeric(6, 2) NOT NULL,
	"test_points" numeric(6, 2) NOT NULL,
	"participation_target" smallint DEFAULT 5 NOT NULL,
	"updated_by" text NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "course_ca_settings_total_check" CHECK ("course_ca_settings"."total" > 0),
	CONSTRAINT "course_ca_settings_attendance_points_check" CHECK ("course_ca_settings"."attendance_points" >= 0),
	CONSTRAINT "course_ca_settings_assignment_points_check" CHECK ("course_ca_settings"."assignment_points" >= 0),
	CONSTRAINT "course_ca_settings_participation_points_check" CHECK ("course_ca_settings"."participation_points" >= 0),
	CONSTRAINT "course_ca_settings_test_points_check" CHECK ("course_ca_settings"."test_points" >= 0),
	CONSTRAINT "course_ca_settings_participation_target_check" CHECK ("course_ca_settings"."participation_target" between 1 and 100)
);
--> statement-breakpoint
CREATE TABLE "participation_event" (
	"id" text PRIMARY KEY NOT NULL,
	"course_id" text NOT NULL,
	"student_id" text NOT NULL,
	"delta" smallint NOT NULL,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "participation_event_delta_check" CHECK ("participation_event"."delta" in (-1, 1))
);
--> statement-breakpoint
ALTER TABLE "course_ca_settings" ADD CONSTRAINT "course_ca_settings_course_id_course_id_fk" FOREIGN KEY ("course_id") REFERENCES "public"."course"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "course_ca_settings" ADD CONSTRAINT "course_ca_settings_updated_by_user_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "participation_event" ADD CONSTRAINT "participation_event_course_id_course_id_fk" FOREIGN KEY ("course_id") REFERENCES "public"."course"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "participation_event" ADD CONSTRAINT "participation_event_student_id_user_id_fk" FOREIGN KEY ("student_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "participation_event" ADD CONSTRAINT "participation_event_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "participation_event_course_student_idx" ON "participation_event" USING btree ("course_id","student_id");--> statement-breakpoint
CREATE INDEX "participation_event_course_creator_created_idx" ON "participation_event" USING btree ("course_id","created_by","created_at");