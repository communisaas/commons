-- A-1: district_hash now uses HMAC-SHA256(district, DISTRICT_HASH_KEY)
-- No schema change needed — the column already exists.
-- This migration is a no-op; the behavioral change is in hashDistrict().
-- Drop district_hash_v2 if it was previously added.
ALTER TABLE "user" DROP COLUMN IF EXISTS "district_hash_v2";
