CREATE TABLE "class_delegate" (
	"class_id" text NOT NULL,
	"student_id" text NOT NULL,
	"appointed_by" text NOT NULL,
	"appointed_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "class_delegate_class_id_student_id_pk" PRIMARY KEY("class_id","student_id")
);
--> statement-breakpoint
ALTER TABLE "class_delegate" ADD CONSTRAINT "class_delegate_class_id_class_id_fk" FOREIGN KEY ("class_id") REFERENCES "public"."class"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "class_delegate" ADD CONSTRAINT "class_delegate_student_id_user_id_fk" FOREIGN KEY ("student_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "class_delegate" ADD CONSTRAINT "class_delegate_appointed_by_user_id_fk" FOREIGN KEY ("appointed_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "class_delegate_student_id_idx" ON "class_delegate" USING btree ("student_id");