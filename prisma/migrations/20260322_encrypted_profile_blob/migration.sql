-- C-4: Encrypted profile blob
-- Aggregates role, organization, location, connection into a single encrypted field

ALTER TABLE "user" ADD COLUMN "encrypted_profile" TEXT;
