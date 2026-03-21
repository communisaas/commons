-- Migration: UserDMRelation — replace user_representatives junction
-- Points user↔decision_maker instead of user↔representative (CongressionalRep).
--
-- Backfill strategy:
--   user_representatives.representative_id → representative.bioguide_id
--   → external_id(system='bioguide', value=bioguide_id) → decision_maker.id
--
-- The user_representatives table is NOT dropped — that happens in a later migration.

BEGIN;

-- ============================================================================
-- 1. Create user_dm_relation table
-- ============================================================================

CREATE TABLE "user_dm_relation" (
  "id" TEXT NOT NULL,
  "user_id" TEXT NOT NULL,
  "decision_maker_id" TEXT NOT NULL,
  "relationship" TEXT NOT NULL,
  "is_active" BOOLEAN NOT NULL DEFAULT true,
  "assigned_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "last_validated" TIMESTAMP(3),
  CONSTRAINT "user_dm_relation_pkey" PRIMARY KEY ("id")
);

-- ============================================================================
-- 2. Create indexes and constraints
-- ============================================================================

CREATE UNIQUE INDEX "user_dm_relation_user_id_decision_maker_id_key"
  ON "user_dm_relation"("user_id", "decision_maker_id");

CREATE INDEX "user_dm_relation_user_id_idx"
  ON "user_dm_relation"("user_id");

CREATE INDEX "user_dm_relation_decision_maker_id_idx"
  ON "user_dm_relation"("decision_maker_id");

-- Foreign keys
ALTER TABLE "user_dm_relation"
  ADD CONSTRAINT "user_dm_relation_user_id_fkey"
  FOREIGN KEY ("user_id") REFERENCES "user"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "user_dm_relation"
  ADD CONSTRAINT "user_dm_relation_decision_maker_id_fkey"
  FOREIGN KEY ("decision_maker_id") REFERENCES "decision_maker"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

-- ============================================================================
-- 3. Backfill from user_representatives
-- ============================================================================
-- Join path:
--   user_representatives.representative_id
--     → representative.id (get bioguide_id)
--     → external_id.value WHERE system = 'bioguide' (get decision_maker_id)
--     → decision_maker.id

INSERT INTO "user_dm_relation" ("id", "user_id", "decision_maker_id", "relationship", "is_active", "assigned_at", "last_validated")
SELECT
  gen_random_uuid()::text,
  ur.user_id,
  ei.decision_maker_id,
  ur.relationship,
  ur.is_active,
  ur.assigned_at,
  ur.last_validated
FROM "user_representatives" ur
JOIN "representative" r ON r.id = ur.representative_id
JOIN "external_id" ei ON ei.system = 'bioguide' AND ei.value = r.bioguide_id
ON CONFLICT ("user_id", "decision_maker_id") DO NOTHING;

COMMIT;
