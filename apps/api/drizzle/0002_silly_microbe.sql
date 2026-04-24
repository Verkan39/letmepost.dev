-- Phase 5.5 — Profiles. Adds the `profiles` table, `profile_id` on
-- platform_accounts (NOT NULL after backfill), and `profile_id` on api_keys
-- (NULL = org-wide). Migration is written idempotently (IF NOT EXISTS,
-- conditional ALTER, ON CONFLICT) so re-runs against a partially-applied DB
-- self-heal instead of failing.

CREATE TABLE IF NOT EXISTS "profiles" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"name" text NOT NULL,
	"slug" varchar(64) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'profiles_organization_id_organization_id_fk'
  ) THEN
    ALTER TABLE "profiles" ADD CONSTRAINT "profiles_organization_id_organization_id_fk"
      FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id")
      ON DELETE cascade ON UPDATE no action;
  END IF;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "profiles_organization_id_idx" ON "profiles" USING btree ("organization_id");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "profiles_org_slug_unique" ON "profiles" USING btree ("organization_id","slug");
--> statement-breakpoint

-- Backfill: one "Default" profile per existing organization. Idempotent
-- via the unique (org, slug) index — re-running this migration is a no-op.
INSERT INTO "profiles" ("id", "organization_id", "name", "slug")
SELECT gen_random_uuid(), o."id", 'Default', 'default'
FROM "organization" o
ON CONFLICT ("organization_id", "slug") DO NOTHING;
--> statement-breakpoint

-- platform_accounts.profile_id: add NULLABLE → backfill → SET NOT NULL.
ALTER TABLE "platform_accounts" ADD COLUMN IF NOT EXISTS "profile_id" uuid;
--> statement-breakpoint
UPDATE "platform_accounts" pa
SET "profile_id" = p."id"
FROM "profiles" p
WHERE p."organization_id" = pa."organization_id"
  AND p."slug" = 'default'
  AND pa."profile_id" IS NULL;
--> statement-breakpoint
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'platform_accounts' AND column_name = 'profile_id' AND is_nullable = 'YES'
  ) THEN
    ALTER TABLE "platform_accounts" ALTER COLUMN "profile_id" SET NOT NULL;
  END IF;
END $$;
--> statement-breakpoint
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'platform_accounts_profile_id_profiles_id_fk'
  ) THEN
    ALTER TABLE "platform_accounts" ADD CONSTRAINT "platform_accounts_profile_id_profiles_id_fk"
      FOREIGN KEY ("profile_id") REFERENCES "public"."profiles"("id")
      ON DELETE restrict ON UPDATE no action;
  END IF;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "platform_accounts_profile_id_idx" ON "platform_accounts" USING btree ("profile_id");
--> statement-breakpoint

-- api_keys.profile_id is intentionally NULLABLE — NULL means the key is
-- org-wide. Existing keys keep working (NULL preserves prior semantics).
ALTER TABLE "api_keys" ADD COLUMN IF NOT EXISTS "profile_id" uuid;
--> statement-breakpoint
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'api_keys_profile_id_profiles_id_fk'
  ) THEN
    ALTER TABLE "api_keys" ADD CONSTRAINT "api_keys_profile_id_profiles_id_fk"
      FOREIGN KEY ("profile_id") REFERENCES "public"."profiles"("id")
      ON DELETE cascade ON UPDATE no action;
  END IF;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "api_keys_profile_id_idx" ON "api_keys" USING btree ("profile_id");
