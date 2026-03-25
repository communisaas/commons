-- T21b+T21c: Add email_hash/encrypted columns to SuppressedEmail, BounceReport, Donation
-- Enables lookup by HMAC-SHA256 hash instead of plaintext email.
-- Plaintext columns retained during transition — drop after backfill.

-- SuppressedEmail: add email_hash (nullable, unique)
ALTER TABLE "suppressed_email" ADD COLUMN "email_hash" TEXT;
CREATE UNIQUE INDEX "suppressed_email_email_hash_key" ON "suppressed_email"("email_hash");

-- BounceReport: add email_hash + encrypted_email (both nullable)
ALTER TABLE "bounce_report" ADD COLUMN "email_hash" TEXT;
ALTER TABLE "bounce_report" ADD COLUMN "encrypted_email" TEXT;
CREATE INDEX "bounce_report_email_hash_resolved_idx" ON "bounce_report"("email_hash", "resolved");

-- Donation: add email_hash + encrypted_email + encrypted_name (all nullable)
ALTER TABLE "donation" ADD COLUMN "email_hash" TEXT;
ALTER TABLE "donation" ADD COLUMN "encrypted_email" TEXT;
ALTER TABLE "donation" ADD COLUMN "encrypted_name" TEXT;
