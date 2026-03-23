-- C-1: Add pseudonymous campaign tracking
-- pseudonym_id = HMAC-SHA256(user_id, ENV key) — deterministic but not reversible without key
ALTER TABLE "template_campaign" ADD COLUMN "pseudonym_id" TEXT;
CREATE INDEX "template_campaign_pseudonym_id_idx" ON "template_campaign" ("pseudonym_id");
