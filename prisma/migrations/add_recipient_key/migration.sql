-- Add recipient_key for stable client-side identity matching
ALTER TABLE "position_delivery" ADD COLUMN "recipient_key" TEXT;
