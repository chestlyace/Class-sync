CREATE TABLE "class_date_status" (
	"slot_id" text NOT NULL,
	"date" date NOT NULL,
	"status" text NOT NULL,
	"set_by" text NOT NULL,
	"set_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "class_date_status_slot_id_date_pk" PRIMARY KEY("slot_id","date"),
	CONSTRAINT "class_date_status_status_check" CHECK ("class_date_status"."status" in ('cancelled', 'missed', 'taught'))
);
--> statement-breakpoint
CREATE TABLE "class_extra" (
	"id" text PRIMARY KEY NOT NULL,
	"course_id" text NOT NULL,
	"starts_at" timestamp with time zone NOT NULL,
	"ends_at" timestamp with time zone NOT NULL,
	"room" text,
	"require_on_campus" boolean DEFAULT false NOT NULL,
	"replaces_slot_id" text,
	"replaces_date" date,
	"status" text,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "class_extra_range_check" CHECK ("class_extra"."ends_at" > "class_extra"."starts_at"),
	CONSTRAINT "class_extra_replaces_check" CHECK (("class_extra"."replaces_slot_id" is null) = ("class_extra"."replaces_date" is null)),
	CONSTRAINT "class_extra_status_check" CHECK ("class_extra"."status" is null or "class_extra"."status" in ('cancelled', 'missed', 'taught'))
);
--> statement-breakpoint
CREATE TABLE "class_notice" (
	"occurrence_key" text NOT NULL,
	"kind" text NOT NULL,
	"sent_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "class_notice_occurrence_key_kind_pk" PRIMARY KEY("occurrence_key","kind")
);
--> statement-breakpoint
CREATE TABLE "class_slot" (
	"id" text PRIMARY KEY NOT NULL,
	"course_id" text NOT NULL,
	"weekday" smallint NOT NULL,
	"start_minute" smallint NOT NULL,
	"end_minute" smallint NOT NULL,
	"room" text,
	"require_on_campus" boolean DEFAULT false NOT NULL,
	"starts_on" date NOT NULL,
	"ends_on" date NOT NULL,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "class_slot_weekday_check" CHECK ("class_slot"."weekday" between 1 and 7),
	CONSTRAINT "class_slot_minutes_check" CHECK ("class_slot"."start_minute" >= 0 and "class_slot"."start_minute" < "class_slot"."end_minute" and "class_slot"."end_minute" <= 1440),
	CONSTRAINT "class_slot_dates_check" CHECK ("class_slot"."ends_on" >= "class_slot"."starts_on")
);
--> statement-breakpoint
CREATE TABLE "notification_preference" (
	"user_id" text PRIMARY KEY NOT NULL,
	"class_reminders" boolean DEFAULT true NOT NULL
);
--> statement-breakpoint
ALTER TABLE "class_date_status" ADD CONSTRAINT "class_date_status_slot_id_class_slot_id_fk" FOREIGN KEY ("slot_id") REFERENCES "public"."class_slot"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "class_date_status" ADD CONSTRAINT "class_date_status_set_by_user_id_fk" FOREIGN KEY ("set_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "class_extra" ADD CONSTRAINT "class_extra_course_id_course_id_fk" FOREIGN KEY ("course_id") REFERENCES "public"."course"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "class_extra" ADD CONSTRAINT "class_extra_replaces_slot_id_class_slot_id_fk" FOREIGN KEY ("replaces_slot_id") REFERENCES "public"."class_slot"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "class_extra" ADD CONSTRAINT "class_extra_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "class_slot" ADD CONSTRAINT "class_slot_course_id_course_id_fk" FOREIGN KEY ("course_id") REFERENCES "public"."course"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "class_slot" ADD CONSTRAINT "class_slot_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification_preference" ADD CONSTRAINT "notification_preference_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "class_extra_course_id_starts_at_idx" ON "class_extra" USING btree ("course_id","starts_at");--> statement-breakpoint
CREATE INDEX "class_slot_course_id_idx" ON "class_slot" USING btree ("course_id");