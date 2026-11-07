ALTER TABLE "class_student" DROP CONSTRAINT "class_student_class_matricule_unique";--> statement-breakpoint
CREATE INDEX "account_user_id_idx" ON "account" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "session_user_id_idx" ON "session" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "verification_identifier_idx" ON "verification" USING btree ("identifier");--> statement-breakpoint
CREATE INDEX "class_lecturer_user_id_idx" ON "class_lecturer" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "class_student_active_matricule_unique" ON "class_student" USING btree ("class_id","matricule") WHERE "class_student"."status" = 'active';--> statement-breakpoint
CREATE INDEX "class_student_user_id_idx" ON "class_student" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "class_school_id_idx" ON "class" USING btree ("school_id");--> statement-breakpoint
CREATE INDEX "course_lecturer_id_idx" ON "course" USING btree ("lecturer_id");--> statement-breakpoint
CREATE INDEX "course_class_id_idx" ON "course" USING btree ("class_id");--> statement-breakpoint
CREATE INDEX "course_roster_adjustment_student_id_idx" ON "course_roster_adjustment" USING btree ("student_id");