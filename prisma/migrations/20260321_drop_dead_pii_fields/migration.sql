-- Drop dead PII fields from user table
-- These fields are never read or written by application code.
-- verification_data: legacy JSON blob, always null
-- bubble_*: postal bubble fields, never implemented beyond schema

ALTER TABLE "user" DROP COLUMN IF EXISTS "verification_data";
ALTER TABLE "user" DROP COLUMN IF EXISTS "bubble_lat";
ALTER TABLE "user" DROP COLUMN IF EXISTS "bubble_lng";
ALTER TABLE "user" DROP COLUMN IF EXISTS "bubble_radius";
ALTER TABLE "user" DROP COLUMN IF EXISTS "bubble_updated";
ALTER TABLE "user" DROP COLUMN IF EXISTS "bubble_seed";
