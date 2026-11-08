CREATE TABLE "course_test" (
	"id" text PRIMARY KEY NOT NULL,
	"course_id" text NOT NULL,
	"code" text NOT NULL,
	"title" text NOT NULL,
	"duration_minutes" smallint NOT NULL,
	"default_mark" numeric(5, 2) NOT NULL,
	"shuffle" boolean DEFAULT true NOT NULL,
	"max_exits" smallint DEFAULT 3 NOT NULL,
	"max_absence_seconds" smallint DEFAULT 10 NOT NULL,
	"started_at" timestamp with time zone,
	"deadline_at" timestamp with time zone,
	"ended_at" timestamp with time zone,
	"results_released_at" timestamp with time zone,
	"copied_from_id" text,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "course_test_code_unique" UNIQUE("code"),
	CONSTRAINT "course_test_duration_check" CHECK ("course_test"."duration_minutes" between 1 and 300),
	CONSTRAINT "course_test_max_exits_check" CHECK ("course_test"."max_exits" between 1 and 10),
	CONSTRAINT "course_test_max_absence_check" CHECK ("course_test"."max_absence_seconds" between 3 and 300),
	CONSTRAINT "course_test_default_mark_check" CHECK ("course_test"."default_mark" > 0),
	CONSTRAINT "course_test_started_deadline_check" CHECK (("course_test"."started_at" is null) = ("course_test"."deadline_at" is null))
);
--> statement-breakpoint
CREATE TABLE "test_answer" (
	"attempt_id" text NOT NULL,
	"question_id" text NOT NULL,
	"option_id" text,
	"text" text,
	"rev" integer NOT NULL,
	"received_at" timestamp with time zone NOT NULL,
	"mark" numeric(5, 2),
	"comment" text,
	"marked_by" text,
	"marked_at" timestamp with time zone,
	"suggested_mark" numeric(5, 2),
	"suggested_reason" text,
	"suggested_at" timestamp with time zone,
	CONSTRAINT "test_answer_attempt_id_question_id_pk" PRIMARY KEY("attempt_id","question_id")
);
--> statement-breakpoint
CREATE TABLE "test_attempt" (
	"id" text PRIMARY KEY NOT NULL,
	"test_id" text NOT NULL,
	"student_id" text NOT NULL,
	"seed" text NOT NULL,
	"device_id" text NOT NULL,
	"device_seen_at" timestamp with time zone NOT NULL,
	"joined_at" timestamp with time zone DEFAULT now() NOT NULL,
	"closed_at" timestamp with time zone,
	"closed_reason" text,
	"exits_since_reopen" smallint DEFAULT 0 NOT NULL,
	CONSTRAINT "test_attempt_test_student_unique" UNIQUE("test_id","student_id"),
	CONSTRAINT "test_attempt_closed_reason_check" CHECK ("test_attempt"."closed_reason" in ('handed_in', 'left'))
);
--> statement-breakpoint
CREATE TABLE "test_exit" (
	"attempt_id" text NOT NULL,
	"exit_id" text NOT NULL,
	"exit_number" smallint NOT NULL,
	"first_reported_at" timestamp with time zone NOT NULL,
	"away_ms" integer,
	"returned_at" timestamp with time zone,
	CONSTRAINT "test_exit_attempt_id_exit_id_pk" PRIMARY KEY("attempt_id","exit_id")
);
--> statement-breakpoint
CREATE TABLE "test_log" (
	"id" text PRIMARY KEY NOT NULL,
	"attempt_id" text NOT NULL,
	"kind" text NOT NULL,
	"at" timestamp with time zone DEFAULT now() NOT NULL,
	"by_user_id" text,
	CONSTRAINT "test_log_kind_check" CHECK ("test_log"."kind" in ('ended_left', 'reopened', 'handed_in'))
);
--> statement-breakpoint
CREATE TABLE "test_option" (
	"id" text PRIMARY KEY NOT NULL,
	"question_id" text NOT NULL,
	"position" smallint NOT NULL,
	"text" text NOT NULL,
	"is_correct" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE TABLE "test_question" (
	"id" text PRIMARY KEY NOT NULL,
	"test_id" text NOT NULL,
	"position" smallint NOT NULL,
	"kind" text NOT NULL,
	"prompt" text NOT NULL,
	"mark" numeric(5, 2),
	"guide" text,
	CONSTRAINT "test_question_kind_check" CHECK ("test_question"."kind" in ('mcq', 'short')),
	CONSTRAINT "test_question_mark_check" CHECK ("test_question"."mark" > 0)
);
--> statement-breakpoint
ALTER TABLE "course_test" ADD CONSTRAINT "course_test_course_id_course_id_fk" FOREIGN KEY ("course_id") REFERENCES "public"."course"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "course_test" ADD CONSTRAINT "course_test_copied_from_id_course_test_id_fk" FOREIGN KEY ("copied_from_id") REFERENCES "public"."course_test"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "course_test" ADD CONSTRAINT "course_test_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "test_answer" ADD CONSTRAINT "test_answer_attempt_id_test_attempt_id_fk" FOREIGN KEY ("attempt_id") REFERENCES "public"."test_attempt"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "test_answer" ADD CONSTRAINT "test_answer_question_id_test_question_id_fk" FOREIGN KEY ("question_id") REFERENCES "public"."test_question"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "test_answer" ADD CONSTRAINT "test_answer_option_id_test_option_id_fk" FOREIGN KEY ("option_id") REFERENCES "public"."test_option"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "test_answer" ADD CONSTRAINT "test_answer_marked_by_user_id_fk" FOREIGN KEY ("marked_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "test_attempt" ADD CONSTRAINT "test_attempt_test_id_course_test_id_fk" FOREIGN KEY ("test_id") REFERENCES "public"."course_test"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "test_attempt" ADD CONSTRAINT "test_attempt_student_id_user_id_fk" FOREIGN KEY ("student_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "test_exit" ADD CONSTRAINT "test_exit_attempt_id_test_attempt_id_fk" FOREIGN KEY ("attempt_id") REFERENCES "public"."test_attempt"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "test_log" ADD CONSTRAINT "test_log_attempt_id_test_attempt_id_fk" FOREIGN KEY ("attempt_id") REFERENCES "public"."test_attempt"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "test_log" ADD CONSTRAINT "test_log_by_user_id_user_id_fk" FOREIGN KEY ("by_user_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "test_option" ADD CONSTRAINT "test_option_question_id_test_question_id_fk" FOREIGN KEY ("question_id") REFERENCES "public"."test_question"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "test_question" ADD CONSTRAINT "test_question_test_id_course_test_id_fk" FOREIGN KEY ("test_id") REFERENCES "public"."course_test"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "course_test_course_id_idx" ON "course_test" USING btree ("course_id");--> statement-breakpoint
CREATE INDEX "test_answer_question_id_idx" ON "test_answer" USING btree ("question_id");--> statement-breakpoint
CREATE INDEX "test_attempt_student_id_idx" ON "test_attempt" USING btree ("student_id");--> statement-breakpoint
CREATE INDEX "test_log_attempt_id_idx" ON "test_log" USING btree ("attempt_id");--> statement-breakpoint
CREATE UNIQUE INDEX "test_option_one_correct_idx" ON "test_option" USING btree ("question_id") WHERE "test_option"."is_correct";--> statement-breakpoint
CREATE INDEX "test_question_test_id_position_idx" ON "test_question" USING btree ("test_id","position");