-- AlterTable: Add encrypted token columns to account table
-- These store AES-256-GCM encrypted OAuth tokens as JSON { ciphertext, iv }
-- Plaintext columns are retained during transition period
ALTER TABLE "account" ADD COLUMN "encrypted_access_token" JSONB;
ALTER TABLE "account" ADD COLUMN "encrypted_refresh_token" JSONB;
ALTER TABLE "account" ADD COLUMN "encrypted_id_token" JSONB;
