CREATE TABLE "attendance_check_in" (
	"window_id" text NOT NULL,
	"student_id" text NOT NULL,
	"checked_in_at" timestamp with time zone DEFAULT now() NOT NULL,
	"latitude" double precision,
	"longitude" double precision,
	"accuracy_m" double precision,
	CONSTRAINT "attendance_check_in_window_id_student_id_pk" PRIMARY KEY("window_id","student_id")
);
--> statement-breakpoint
CREATE TABLE "attendance_code_failure" (
	"window_id" text NOT NULL,
	"student_id" text NOT NULL,
	"failures" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "attendance_code_failure_window_id_student_id_pk" PRIMARY KEY("window_id","student_id")
);
--> statement-breakpoint
CREATE TABLE "attendance_override" (
	"session_id" text NOT NULL,
	"student_id" text NOT NULL,
	"status" text NOT NULL,
	"set_by" text NOT NULL,
	"set_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "attendance_override_session_id_student_id_pk" PRIMARY KEY("session_id","student_id"),
	CONSTRAINT "attendance_override_status_check" CHECK ("attendance_override"."status" in ('present', 'partial', 'absent'))
);
--> statement-breakpoint
CREATE TABLE "attendance_session" (
	"id" text PRIMARY KEY NOT NULL,
	"course_id" text NOT NULL,
	"require_on_campus" boolean DEFAULT false NOT NULL,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "attendance_window" (
	"id" text PRIMARY KEY NOT NULL,
	"session_id" text NOT NULL,
	"kind" text NOT NULL,
	"secret" text NOT NULL,
	"opened_at" timestamp with time zone DEFAULT now() NOT NULL,
	"closed_at" timestamp with time zone,
	"opened_by" text NOT NULL,
	CONSTRAINT "attendance_window_session_kind_unique" UNIQUE("session_id","kind"),
	CONSTRAINT "attendance_window_kind_check" CHECK ("attendance_window"."kind" in ('start', 'end'))
);
--> statement-breakpoint
ALTER TABLE "attendance_check_in" ADD CONSTRAINT "attendance_check_in_window_id_attendance_window_id_fk" FOREIGN KEY ("window_id") REFERENCES "public"."attendance_window"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attendance_check_in" ADD CONSTRAINT "attendance_check_in_student_id_user_id_fk" FOREIGN KEY ("student_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attendance_code_failure" ADD CONSTRAINT "attendance_code_failure_window_id_attendance_window_id_fk" FOREIGN KEY ("window_id") REFERENCES "public"."attendance_window"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attendance_code_failure" ADD CONSTRAINT "attendance_code_failure_student_id_user_id_fk" FOREIGN KEY ("student_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attendance_override" ADD CONSTRAINT "attendance_override_session_id_attendance_session_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."attendance_session"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attendance_override" ADD CONSTRAINT "attendance_override_student_id_user_id_fk" FOREIGN KEY ("student_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attendance_override" ADD CONSTRAINT "attendance_override_set_by_user_id_fk" FOREIGN KEY ("set_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attendance_session" ADD CONSTRAINT "attendance_session_course_id_course_id_fk" FOREIGN KEY ("course_id") REFERENCES "public"."course"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attendance_session" ADD CONSTRAINT "attendance_session_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attendance_window" ADD CONSTRAINT "attendance_window_session_id_attendance_session_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."attendance_session"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attendance_window" ADD CONSTRAINT "attendance_window_opened_by_user_id_fk" FOREIGN KEY ("opened_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "attendance_check_in_student_id_idx" ON "attendance_check_in" USING btree ("student_id");--> statement-breakpoint
CREATE INDEX "attendance_session_course_id_idx" ON "attendance_session" USING btree ("course_id");--> statement-breakpoint
CREATE INDEX "attendance_window_session_id_idx" ON "attendance_window" USING btree ("session_id");