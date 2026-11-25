ALTER TABLE "user" ADD COLUMN "phone_number" text;--> statement-breakpoint
ALTER TABLE "user" ADD COLUMN "phone_number_verified" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "user" ADD CONSTRAINT "user_phone_number_unique" UNIQUE("phone_number");
--> statement-breakpoint
-- A number linked for WhatsApp alerts was proven by a JOIN message from that phone, so it counts as verified.
UPDATE "user" SET "phone_number" = "whatsapp_link"."phone", "phone_number_verified" = true
FROM "whatsapp_link"
WHERE "whatsapp_link"."user_id" = "user"."id"
  AND NOT EXISTS (
    SELECT 1 FROM "user" AS "other"
    WHERE "other"."phone_number" = "whatsapp_link"."phone" AND "other"."id" <> "user"."id"
  );
