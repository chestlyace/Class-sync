CREATE TABLE "course_topic" (
	"id" text PRIMARY KEY NOT NULL,
	"course_id" text NOT NULL,
	"title" text NOT NULL,
	"position" integer NOT NULL,
	"hidden" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "resource" (
	"id" text PRIMARY KEY NOT NULL,
	"owner_id" text NOT NULL,
	"kind" text NOT NULL,
	"title" text NOT NULL,
	"body" jsonb,
	"body_text" text,
	"url" text,
	"file_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "resource_file_id_unique" UNIQUE("file_id"),
	CONSTRAINT "resource_kind_check" CHECK ("resource"."kind" in ('note', 'file', 'link')),
	CONSTRAINT "resource_link_url_check" CHECK (("resource"."kind" = 'link') = ("resource"."url" is not null)),
	CONSTRAINT "resource_file_file_id_check" CHECK (("resource"."kind" = 'file') = ("resource"."file_id" is not null))
);
--> statement-breakpoint
CREATE TABLE "resource_placement" (
	"resource_id" text NOT NULL,
	"course_id" text NOT NULL,
	"topic_id" text NOT NULL,
	"position" integer NOT NULL,
	"added_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "resource_placement_resource_id_course_id_pk" PRIMARY KEY("resource_id","course_id")
);
--> statement-breakpoint
CREATE TABLE "resource_view" (
	"resource_id" text NOT NULL,
	"student_id" text NOT NULL,
	"viewed_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "resource_view_resource_id_student_id_pk" PRIMARY KEY("resource_id","student_id")
);
--> statement-breakpoint
CREATE TABLE "revision_group" (
	"id" text PRIMARY KEY NOT NULL,
	"course_id" text NOT NULL,
	"topic_id" text NOT NULL,
	"source_test_id" text,
	"source_family_id" text,
	"source_title" text,
	"position" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "revision_option" (
	"id" text PRIMARY KEY NOT NULL,
	"question_id" text NOT NULL,
	"position" integer NOT NULL,
	"text" text NOT NULL,
	"is_correct" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE TABLE "revision_outcome" (
	"student_id" text NOT NULL,
	"question_id" text NOT NULL,
	"correct" boolean NOT NULL,
	"answered_at" timestamp with time zone NOT NULL,
	CONSTRAINT "revision_outcome_student_id_question_id_pk" PRIMARY KEY("student_id","question_id")
);
--> statement-breakpoint
CREATE TABLE "revision_question" (
	"id" text PRIMARY KEY NOT NULL,
	"group_id" text NOT NULL,
	"position" integer NOT NULL,
	"kind" text NOT NULL,
	"prompt" text NOT NULL,
	"guide" text,
	"explanation" text,
	CONSTRAINT "revision_question_kind_check" CHECK ("revision_question"."kind" in ('mcq', 'short'))
);
--> statement-breakpoint
ALTER TABLE "file" DROP CONSTRAINT "file_purpose_check";--> statement-breakpoint
ALTER TABLE "course_test" ADD COLUMN "family_id" text;--> statement-breakpoint
WITH RECURSIVE chain(id, root) AS (
  SELECT id, id FROM course_test WHERE copied_from_id IS NULL
  UNION ALL
  SELECT t.id, c.root FROM course_test t JOIN chain c ON t.copied_from_id = c.id
)
UPDATE course_test SET family_id = chain.root FROM chain WHERE course_test.id = chain.id;--> statement-breakpoint
UPDATE course_test SET family_id = id WHERE family_id IS NULL;--> statement-breakpoint
ALTER TABLE "course_test" ALTER COLUMN "family_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "course_topic" ADD CONSTRAINT "course_topic_course_id_course_id_fk" FOREIGN KEY ("course_id") REFERENCES "public"."course"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "resource" ADD CONSTRAINT "resource_owner_id_user_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "resource" ADD CONSTRAINT "resource_file_id_file_id_fk" FOREIGN KEY ("file_id") REFERENCES "public"."file"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "resource_placement" ADD CONSTRAINT "resource_placement_resource_id_resource_id_fk" FOREIGN KEY ("resource_id") REFERENCES "public"."resource"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "resource_placement" ADD CONSTRAINT "resource_placement_course_id_course_id_fk" FOREIGN KEY ("course_id") REFERENCES "public"."course"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "resource_placement" ADD CONSTRAINT "resource_placement_topic_id_course_topic_id_fk" FOREIGN KEY ("topic_id") REFERENCES "public"."course_topic"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "resource_view" ADD CONSTRAINT "resource_view_resource_id_resource_id_fk" FOREIGN KEY ("resource_id") REFERENCES "public"."resource"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "resource_view" ADD CONSTRAINT "resource_view_student_id_user_id_fk" FOREIGN KEY ("student_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "revision_group" ADD CONSTRAINT "revision_group_course_id_course_id_fk" FOREIGN KEY ("course_id") REFERENCES "public"."course"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "revision_group" ADD CONSTRAINT "revision_group_topic_id_course_topic_id_fk" FOREIGN KEY ("topic_id") REFERENCES "public"."course_topic"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "revision_group" ADD CONSTRAINT "revision_group_source_test_id_course_test_id_fk" FOREIGN KEY ("source_test_id") REFERENCES "public"."course_test"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "revision_option" ADD CONSTRAINT "revision_option_question_id_revision_question_id_fk" FOREIGN KEY ("question_id") REFERENCES "public"."revision_question"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "revision_outcome" ADD CONSTRAINT "revision_outcome_student_id_user_id_fk" FOREIGN KEY ("student_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "revision_outcome" ADD CONSTRAINT "revision_outcome_question_id_revision_question_id_fk" FOREIGN KEY ("question_id") REFERENCES "public"."revision_question"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "revision_question" ADD CONSTRAINT "revision_question_group_id_revision_group_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."revision_group"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "course_topic_course_id_position_idx" ON "course_topic" USING btree ("course_id","position");--> statement-breakpoint
CREATE INDEX "resource_owner_id_idx" ON "resource" USING btree ("owner_id");--> statement-breakpoint
CREATE INDEX "resource_placement_topic_id_position_idx" ON "resource_placement" USING btree ("topic_id","position");--> statement-breakpoint
CREATE INDEX "resource_placement_course_id_idx" ON "resource_placement" USING btree ("course_id");--> statement-breakpoint
CREATE INDEX "resource_view_student_id_idx" ON "resource_view" USING btree ("student_id");--> statement-breakpoint
CREATE UNIQUE INDEX "revision_group_course_source_test_idx" ON "revision_group" USING btree ("course_id","source_test_id") WHERE "revision_group"."source_test_id" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "revision_group_topic_written_here_idx" ON "revision_group" USING btree ("topic_id") WHERE "revision_group"."source_family_id" is null;--> statement-breakpoint
CREATE INDEX "revision_group_topic_id_position_idx" ON "revision_group" USING btree ("topic_id","position");--> statement-breakpoint
CREATE INDEX "revision_group_course_id_idx" ON "revision_group" USING btree ("course_id");--> statement-breakpoint
CREATE UNIQUE INDEX "revision_option_one_correct_idx" ON "revision_option" USING btree ("question_id") WHERE "revision_option"."is_correct";--> statement-breakpoint
CREATE INDEX "revision_outcome_question_id_idx" ON "revision_outcome" USING btree ("question_id");--> statement-breakpoint
CREATE INDEX "revision_question_group_id_position_idx" ON "revision_question" USING btree ("group_id","position");--> statement-breakpoint
CREATE INDEX "course_test_family_id_idx" ON "course_test" USING btree ("family_id");--> statement-breakpoint
ALTER TABLE "file" ADD CONSTRAINT "file_purpose_check" CHECK ("file"."purpose" in ('assignment', 'submission', 'resource'));