-- Phase 7.5 — Media upload service. Adds the `media` table that anchors
-- bytes uploaded via POST /v1/media: the bytes live in S3, this row is
-- the metadata + tenancy anchor that publishers dereference from
-- `media: [{ kind, mediaId }]` in post bodies.
--
-- Idempotent (IF NOT EXISTS, conditional ALTER) so re-runs against a
-- partially-applied DB self-heal.

CREATE TABLE IF NOT EXISTS "media" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"profile_id" uuid NOT NULL,
	"content_type" text NOT NULL,
	"size_bytes" bigint NOT NULL,
	"sha256" text NOT NULL,
	"s3_key" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'media_organization_id_organization_id_fk'
  ) THEN
    ALTER TABLE "media" ADD CONSTRAINT "media_organization_id_organization_id_fk"
      FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id")
      ON DELETE cascade ON UPDATE no action;
  END IF;
END $$;
--> statement-breakpoint
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'media_profile_id_profiles_id_fk'
  ) THEN
    ALTER TABLE "media" ADD CONSTRAINT "media_profile_id_profiles_id_fk"
      FOREIGN KEY ("profile_id") REFERENCES "public"."profiles"("id")
      ON DELETE restrict ON UPDATE no action;
  END IF;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "media_organization_id_idx" ON "media" USING btree ("organization_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "media_profile_id_idx" ON "media" USING btree ("profile_id");
