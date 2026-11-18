CREATE TABLE "whatsapp_connect_code" (
	"code" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"used_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "whatsapp_link" (
	"user_id" text PRIMARY KEY NOT NULL,
	"phone" text NOT NULL,
	"linked_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "whatsapp_link_phone_unique" UNIQUE("phone")
);
--> statement-breakpoint
CREATE TABLE "whatsapp_message" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text,
	"kind" text NOT NULL,
	"event_key" text NOT NULL,
	"template" text NOT NULL,
	"provider_message_id" text,
	"status" text NOT NULL,
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "whatsapp_message_provider_message_id_unique" UNIQUE("provider_message_id"),
	CONSTRAINT "whatsapp_message_user_event_unique" UNIQUE("user_id","event_key")
);
--> statement-breakpoint
CREATE TABLE "whatsapp_month_usage" (
	"month" text PRIMARY KEY NOT NULL,
	"sent" integer DEFAULT 0 NOT NULL,
	"cap_mailed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "whatsapp_preference" (
	"user_id" text PRIMARY KEY NOT NULL,
	"checkin" boolean DEFAULT true NOT NULL,
	"tests" boolean DEFAULT true NOT NULL,
	"results" boolean DEFAULT true NOT NULL,
	"assignments" boolean DEFAULT true NOT NULL,
	"class_soon" boolean DEFAULT true NOT NULL
);
--> statement-breakpoint
ALTER TABLE "whatsapp_connect_code" ADD CONSTRAINT "whatsapp_connect_code_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "whatsapp_link" ADD CONSTRAINT "whatsapp_link_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "whatsapp_message" ADD CONSTRAINT "whatsapp_message_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "whatsapp_preference" ADD CONSTRAINT "whatsapp_preference_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "whatsapp_connect_code_user_id_idx" ON "whatsapp_connect_code" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "whatsapp_message_created_at_idx" ON "whatsapp_message" USING btree ("created_at");