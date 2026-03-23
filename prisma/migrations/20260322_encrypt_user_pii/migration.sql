-- C-3: Encrypt email and name at rest
-- Add encrypted PII columns + email_hash for HMAC-based lookups

ALTER TABLE "user" ADD COLUMN "encrypted_email" TEXT;
ALTER TABLE "user" ADD COLUMN "encrypted_name" TEXT;
ALTER TABLE "user" ADD COLUMN "email_hash" TEXT;

-- Unique index on email_hash (replaces email unique constraint after backfill)
CREATE UNIQUE INDEX "user_email_hash_key" ON "user"("email_hash");
