-- Bounce report triage: store user reports without immediate suppression.
-- Suppression only after SMTP probe confirms OR 3+ independent reporters.

CREATE TABLE IF NOT EXISTS "bounce_report" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "domain" TEXT NOT NULL,
    "reported_by" TEXT NOT NULL,
    "probe_result" TEXT,
    "resolved" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "bounce_report_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "bounce_report_email_resolved_idx" ON "bounce_report"("email", "resolved");
CREATE INDEX "bounce_report_reported_by_idx" ON "bounce_report"("reported_by");

-- Also remove the accidental suppression from the user's test click
-- (source='user_report', reason='bounce_report', created in the last hour)
DELETE FROM "suppressed_email"
WHERE source = 'user_report'
  AND reason = 'bounce_report'
  AND created_at > NOW() - INTERVAL '2 hours';
