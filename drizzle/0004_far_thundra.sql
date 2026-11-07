CREATE TABLE "assignment" (
	"id" text PRIMARY KEY NOT NULL,
	"course_id" text NOT NULL,
	"title" text NOT NULL,
	"instructions" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"due_at" timestamp with time zone NOT NULL,
	"max_mark" numeric(7, 2) NOT NULL,
	"weight" numeric(6, 2) DEFAULT 1 NOT NULL,
	"submission_mode" text NOT NULL,
	"late_policy" text DEFAULT 'accept' NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"published_at" timestamp with time zone,
	"grades_released_at" timestamp with time zone,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "assignment_submission_mode_check" CHECK ("assignment"."submission_mode" in ('files', 'text', 'both')),
	CONSTRAINT "assignment_late_policy_check" CHECK ("assignment"."late_policy" in ('accept', 'close')),
	CONSTRAINT "assignment_status_check" CHECK ("assignment"."status" in ('draft', 'published'))
);
--> statement-breakpoint
CREATE TABLE "assignment_attachment" (
	"assignment_id" text NOT NULL,
	"file_id" text NOT NULL,
	"position" smallint NOT NULL,
	CONSTRAINT "assignment_attachment_assignment_id_file_id_pk" PRIMARY KEY("assignment_id","file_id")
);
--> statement-breakpoint
CREATE TABLE "assignment_reminder" (
	"assignment_id" text NOT NULL,
	"student_id" text NOT NULL,
	"sent_at" timestamp with time zone NOT NULL,
	CONSTRAINT "assignment_reminder_assignment_id_student_id_pk" PRIMARY KEY("assignment_id","student_id")
);
--> statement-breakpoint
CREATE TABLE "file" (
	"id" text PRIMARY KEY NOT NULL,
	"owner_id" text NOT NULL,
	"purpose" text NOT NULL,
	"storage_key" text NOT NULL,
	"name" text NOT NULL,
	"mime_type" text NOT NULL,
	"size_bytes" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"confirmed_at" timestamp with time zone,
	CONSTRAINT "file_storage_key_unique" UNIQUE("storage_key"),
	CONSTRAINT "file_purpose_check" CHECK ("file"."purpose" in ('assignment', 'submission'))
);
--> statement-breakpoint
CREATE TABLE "submission" (
	"id" text PRIMARY KEY NOT NULL,
	"assignment_id" text NOT NULL,
	"student_id" text NOT NULL,
	"text" jsonb,
	"submitted_at" timestamp with time zone NOT NULL,
	"is_late" boolean DEFAULT false NOT NULL,
	"mark" numeric(7, 2),
	"feedback" text,
	"graded_at" timestamp with time zone,
	"graded_by" text,
	CONSTRAINT "submission_assignment_student_unique" UNIQUE("assignment_id","student_id")
);
--> statement-breakpoint
CREATE TABLE "submission_file" (
	"submission_id" text NOT NULL,
	"file_id" text NOT NULL,
	"position" smallint NOT NULL,
	CONSTRAINT "submission_file_submission_id_file_id_pk" PRIMARY KEY("submission_id","file_id")
);
--> statement-breakpoint
ALTER TABLE "assignment" ADD CONSTRAINT "assignment_course_id_course_id_fk" FOREIGN KEY ("course_id") REFERENCES "public"."course"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assignment" ADD CONSTRAINT "assignment_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assignment_attachment" ADD CONSTRAINT "assignment_attachment_assignment_id_assignment_id_fk" FOREIGN KEY ("assignment_id") REFERENCES "public"."assignment"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assignment_attachment" ADD CONSTRAINT "assignment_attachment_file_id_file_id_fk" FOREIGN KEY ("file_id") REFERENCES "public"."file"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assignment_reminder" ADD CONSTRAINT "assignment_reminder_assignment_id_assignment_id_fk" FOREIGN KEY ("assignment_id") REFERENCES "public"."assignment"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assignment_reminder" ADD CONSTRAINT "assignment_reminder_student_id_user_id_fk" FOREIGN KEY ("student_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "file" ADD CONSTRAINT "file_owner_id_user_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "submission" ADD CONSTRAINT "submission_assignment_id_assignment_id_fk" FOREIGN KEY ("assignment_id") REFERENCES "public"."assignment"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "submission" ADD CONSTRAINT "submission_student_id_user_id_fk" FOREIGN KEY ("student_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "submission" ADD CONSTRAINT "submission_graded_by_user_id_fk" FOREIGN KEY ("graded_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "submission_file" ADD CONSTRAINT "submission_file_submission_id_submission_id_fk" FOREIGN KEY ("submission_id") REFERENCES "public"."submission"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "submission_file" ADD CONSTRAINT "submission_file_file_id_file_id_fk" FOREIGN KEY ("file_id") REFERENCES "public"."file"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "assignment_course_id_idx" ON "assignment" USING btree ("course_id");--> statement-breakpoint
CREATE INDEX "assignment_status_due_at_idx" ON "assignment" USING btree ("status","due_at");--> statement-breakpoint
CREATE INDEX "file_owner_id_idx" ON "file" USING btree ("owner_id");--> statement-breakpoint
CREATE INDEX "submission_student_id_idx" ON "submission" USING btree ("student_id");