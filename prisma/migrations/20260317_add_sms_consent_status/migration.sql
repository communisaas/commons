-- Add SMS consent status to supporter table.
-- Default 'none' ensures existing supporters are NOT opted in (TCPA compliance).
ALTER TABLE "supporter" ADD COLUMN "sms_status" TEXT NOT NULL DEFAULT 'none';

-- Index for filtering SMS blast recipients
CREATE INDEX "supporter_sms_status_idx" ON "supporter"("sms_status");
