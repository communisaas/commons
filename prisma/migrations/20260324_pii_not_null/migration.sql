-- T14: Make encrypted PII columns NOT NULL on User table.
-- Backfill verified complete (T9-T13). All rows have encrypted_email and email_hash.
-- Plaintext email/name columns are NOT dropped here — separate cycle with 30-day bake.

-- Set any remaining nulls to empty string (safety net — backfill should have caught all)
UPDATE "user" SET encrypted_email = '' WHERE encrypted_email IS NULL;
UPDATE "user" SET email_hash = '' WHERE email_hash IS NULL;

-- Enforce NOT NULL
ALTER TABLE "user" ALTER COLUMN "encrypted_email" SET NOT NULL;
ALTER TABLE "user" ALTER COLUMN "email_hash" SET NOT NULL;
