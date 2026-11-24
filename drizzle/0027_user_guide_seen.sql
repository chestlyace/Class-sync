CREATE TABLE "user_guide_seen" (
	"user_id" text NOT NULL,
	"guide_id" text NOT NULL,
	"seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "user_guide_seen_user_id_guide_id_pk" PRIMARY KEY("user_id","guide_id")
);
--> statement-breakpoint
ALTER TABLE "user_guide_seen" ADD CONSTRAINT "user_guide_seen_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;