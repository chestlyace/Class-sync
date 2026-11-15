CREATE TABLE "test_practice_outcome" (
	"student_id" text NOT NULL,
	"question_id" text NOT NULL,
	"correct" boolean NOT NULL,
	"answered_at" timestamp with time zone NOT NULL,
	CONSTRAINT "test_practice_outcome_student_id_question_id_pk" PRIMARY KEY("student_id","question_id")
);
--> statement-breakpoint
ALTER TABLE "course_test" ADD COLUMN "students_can_review" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "test_practice_outcome" ADD CONSTRAINT "test_practice_outcome_student_id_user_id_fk" FOREIGN KEY ("student_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "test_practice_outcome" ADD CONSTRAINT "test_practice_outcome_question_id_test_question_id_fk" FOREIGN KEY ("question_id") REFERENCES "public"."test_question"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "test_practice_outcome_question_id_idx" ON "test_practice_outcome" USING btree ("question_id");