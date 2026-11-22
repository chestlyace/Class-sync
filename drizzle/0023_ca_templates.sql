CREATE TABLE "ca_template" (
	"id" text PRIMARY KEY NOT NULL,
	"owner_id" text NOT NULL,
	"name" text NOT NULL,
	"settings" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ca_template_default" (
	"user_id" text PRIMARY KEY NOT NULL,
	"template_id" text,
	"built_in_id" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ca_template_default_one_check" CHECK (("ca_template_default"."template_id" is null) <> ("ca_template_default"."built_in_id" is null))
);
--> statement-breakpoint
CREATE TABLE "ca_test_group" (
	"id" text PRIMARY KEY NOT NULL,
	"course_id" text NOT NULL,
	"name" text NOT NULL,
	"points" numeric(6, 2) NOT NULL,
	"best_of" smallint,
	"position" smallint NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ca_test_group_points_check" CHECK ("ca_test_group"."points" >= 0),
	CONSTRAINT "ca_test_group_best_of_check" CHECK ("ca_test_group"."best_of" between 1 and 50)
);
--> statement-breakpoint
ALTER TABLE "course_test" ADD COLUMN "counts_in_ca" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "course_test" ADD COLUMN "ca_group_id" text;--> statement-breakpoint
ALTER TABLE "ca_template" ADD CONSTRAINT "ca_template_owner_id_user_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ca_template_default" ADD CONSTRAINT "ca_template_default_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ca_template_default" ADD CONSTRAINT "ca_template_default_template_id_ca_template_id_fk" FOREIGN KEY ("template_id") REFERENCES "public"."ca_template"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ca_test_group" ADD CONSTRAINT "ca_test_group_course_id_course_id_fk" FOREIGN KEY ("course_id") REFERENCES "public"."course"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "ca_template_owner_name_idx" ON "ca_template" USING btree ("owner_id",lower("name"));--> statement-breakpoint
CREATE UNIQUE INDEX "ca_test_group_course_name_idx" ON "ca_test_group" USING btree ("course_id",lower("name"));--> statement-breakpoint
ALTER TABLE "course_test" ADD CONSTRAINT "course_test_ca_group_id_ca_test_group_id_fk" FOREIGN KEY ("ca_group_id") REFERENCES "public"."ca_test_group"("id") ON DELETE set null ON UPDATE no action;