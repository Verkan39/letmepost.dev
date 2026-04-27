-- Adds `youtube` to the `platform` enum. `tiktok` stays — deferred to v2,
-- but removing an enum value in Postgres is awkward and unnecessary.
-- Idempotent via IF NOT EXISTS.
ALTER TYPE "public"."platform" ADD VALUE IF NOT EXISTS 'youtube' BEFORE 'tiktok';
