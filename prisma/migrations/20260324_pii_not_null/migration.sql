-- T14: Make encrypted PII columns NOT NULL on User table.
-- Backfill verified complete (T9-T13). All rows have encrypted_email and email_hash.
-- Plaintext email/name columns are NOT dropped here — separate cycle with 30-day bake.

-- Guard: abort if any rows still have NULL encrypted PII (backfill incomplete)
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM "user" WHERE encrypted_email IS NULL OR email_hash IS NULL LIMIT 1) THEN
    RAISE EXCEPTION 'Cannot enforce NOT NULL — unencrypted user rows exist. Run PII backfill first.';
  END IF;
END $$;

-- Enforce NOT NULL (backfill verified complete via T9-T13)
ALTER TABLE "user" ALTER COLUMN "encrypted_email" SET NOT NULL;
ALTER TABLE "user" ALTER COLUMN "email_hash" SET NOT NULL;
