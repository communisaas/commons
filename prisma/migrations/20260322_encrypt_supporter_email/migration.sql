-- C-5: Encrypt Supporter email at rest
-- Add encrypted email + HMAC hash for dedup lookups

ALTER TABLE "supporter" ADD COLUMN "encrypted_email" TEXT;
ALTER TABLE "supporter" ADD COLUMN "email_hash" TEXT;

-- Composite unique index for org-scoped dedup (replaces orgId_email after backfill)
CREATE UNIQUE INDEX "supporter_org_id_email_hash_key" ON "supporter"("org_id", "email_hash");
