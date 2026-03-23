-- Add email_verified column to account table
-- Tracks whether the OAuth provider verified the user's email (ISSUE-002: Sybil resistance)
-- Defaults to true for backwards compatibility (most providers verify email)
ALTER TABLE "account" ADD COLUMN "email_verified" BOOLEAN NOT NULL DEFAULT true;
