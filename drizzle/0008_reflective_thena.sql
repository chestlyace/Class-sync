ALTER TABLE "course_ca_settings" ADD COLUMN "tests_best_of" smallint;--> statement-breakpoint
ALTER TABLE "course_test" ADD COLUMN "weight" numeric(6, 2) DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "course_ca_settings" ADD CONSTRAINT "course_ca_settings_tests_best_of_check" CHECK ("course_ca_settings"."tests_best_of" between 1 and 50);--> statement-breakpoint
ALTER TABLE "course_test" ADD CONSTRAINT "course_test_weight_check" CHECK ("course_test"."weight" between 0.25 and 100);