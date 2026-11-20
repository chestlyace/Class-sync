CREATE TABLE "test_catch_up_student" (
	"test_id" text NOT NULL,
	"student_id" text NOT NULL,
	"added_at" timestamp with time zone DEFAULT now() NOT NULL,
	"added_by" text NOT NULL,
	CONSTRAINT "test_catch_up_student_test_id_student_id_pk" PRIMARY KEY("test_id","student_id")
);
--> statement-breakpoint
ALTER TABLE "course_test" ADD COLUMN "catch_up_of_id" text;--> statement-breakpoint
ALTER TABLE "course_test" ADD COLUMN "catch_up_for" text;--> statement-breakpoint
ALTER TABLE "test_catch_up_student" ADD CONSTRAINT "test_catch_up_student_test_id_course_test_id_fk" FOREIGN KEY ("test_id") REFERENCES "public"."course_test"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "test_catch_up_student" ADD CONSTRAINT "test_catch_up_student_student_id_user_id_fk" FOREIGN KEY ("student_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "test_catch_up_student" ADD CONSTRAINT "test_catch_up_student_added_by_user_id_fk" FOREIGN KEY ("added_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "course_test" ADD CONSTRAINT "course_test_catch_up_of_id_course_test_id_fk" FOREIGN KEY ("catch_up_of_id") REFERENCES "public"."course_test"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "course_test_catch_up_of_id_idx" ON "course_test" USING btree ("catch_up_of_id");--> statement-breakpoint
ALTER TABLE "course_test" ADD CONSTRAINT "course_test_catch_up_check" CHECK (("course_test"."catch_up_of_id" is null) = ("course_test"."catch_up_for" is null));