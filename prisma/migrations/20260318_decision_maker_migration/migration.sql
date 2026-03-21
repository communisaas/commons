-- Migration: DecisionMaker unification
-- Creates DecisionMaker as the canonical accountability target, replacing the
-- Congress-specific Representative model with a universal entity.
--
-- Data sources migrated:
--   1. representative (CongressionalRep) → decision_maker + external_id(bioguide)
--   2. international_representatives → decision_maker + external_id(constituency)
--
-- The representative table is NOT dropped — CongressionalRep model still uses it.
-- Only international_representatives is dropped (model removed from schema).

BEGIN;

-- ============================================================================
-- 1. Create new tables
-- ============================================================================

-- Institution: organizational body a decision-maker belongs to
CREATE TABLE "institution" (
  "id" TEXT NOT NULL,
  "type" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "jurisdiction" TEXT,
  "jurisdiction_level" TEXT,
  "parent_id" TEXT,
  "website_url" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "institution_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "institution_parent_id_fkey" FOREIGN KEY ("parent_id")
    REFERENCES "institution"("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "institution_type_name_jurisdiction_key"
  ON "institution"("type", "name", "jurisdiction");
CREATE INDEX "institution_type_idx" ON "institution"("type");
CREATE INDEX "institution_jurisdiction_level_idx" ON "institution"("jurisdiction_level");
CREATE INDEX "institution_parent_id_idx" ON "institution"("parent_id");

-- DecisionMaker: canonical identity for any accountability target
CREATE TABLE "decision_maker" (
  "id" TEXT NOT NULL,
  "type" TEXT NOT NULL,
  "title" TEXT,
  "name" TEXT NOT NULL,
  "first_name" TEXT,
  "last_name" TEXT NOT NULL,
  "party" TEXT,
  "jurisdiction" TEXT,
  "jurisdiction_level" TEXT,
  "district" TEXT,
  "phone" TEXT,
  "email" TEXT,
  "website_url" TEXT,
  "office_address" TEXT,
  "photo_url" TEXT,
  "active" BOOLEAN NOT NULL DEFAULT true,
  "term_start" TIMESTAMP(3),
  "term_end" TIMESTAMP(3),
  "last_synced_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  "institution_id" TEXT,
  CONSTRAINT "decision_maker_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "decision_maker_institution_id_fkey" FOREIGN KEY ("institution_id")
    REFERENCES "institution"("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE INDEX "decision_maker_type_idx" ON "decision_maker"("type");
CREATE INDEX "decision_maker_jurisdiction_jurisdiction_level_idx"
  ON "decision_maker"("jurisdiction", "jurisdiction_level");
CREATE INDEX "decision_maker_party_idx" ON "decision_maker"("party");
CREATE INDEX "decision_maker_last_name_idx" ON "decision_maker"("last_name");
CREATE INDEX "decision_maker_institution_id_idx" ON "decision_maker"("institution_id");
CREATE INDEX "decision_maker_active_idx" ON "decision_maker"("active");

-- ExternalId: cross-system identifier (bioguide, openstates, constituency, etc.)
CREATE TABLE "external_id" (
  "id" TEXT NOT NULL,
  "decision_maker_id" TEXT NOT NULL,
  "system" TEXT NOT NULL,
  "value" TEXT NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "external_id_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "external_id_decision_maker_id_fkey" FOREIGN KEY ("decision_maker_id")
    REFERENCES "decision_maker"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "external_id_decision_maker_id_system_key"
  ON "external_id"("decision_maker_id", "system");
CREATE UNIQUE INDEX "external_id_system_value_key"
  ON "external_id"("system", "value");
CREATE INDEX "external_id_system_value_idx"
  ON "external_id"("system", "value");

-- OrgDMFollow: org follows a decision-maker for persistent tracking
CREATE TABLE "org_dm_follow" (
  "id" TEXT NOT NULL,
  "org_id" TEXT NOT NULL,
  "decision_maker_id" TEXT NOT NULL,
  "reason" TEXT NOT NULL DEFAULT 'manual',
  "alerts_enabled" BOOLEAN NOT NULL DEFAULT true,
  "note" TEXT,
  "followed_by" TEXT,
  "followed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "org_dm_follow_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "org_dm_follow_org_id_fkey" FOREIGN KEY ("org_id")
    REFERENCES "organization"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "org_dm_follow_decision_maker_id_fkey" FOREIGN KEY ("decision_maker_id")
    REFERENCES "decision_maker"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "org_dm_follow_org_id_decision_maker_id_key"
  ON "org_dm_follow"("org_id", "decision_maker_id");
CREATE INDEX "org_dm_follow_org_id_idx" ON "org_dm_follow"("org_id");
CREATE INDEX "org_dm_follow_decision_maker_id_idx" ON "org_dm_follow"("decision_maker_id");

-- ============================================================================
-- 2. Seed Institution data
-- ============================================================================

INSERT INTO "institution" ("id", "type", "name", "jurisdiction", "jurisdiction_level", "updated_at")
VALUES
  ('inst_us_house', 'legislature', 'U.S. House of Representatives', 'US', 'federal', CURRENT_TIMESTAMP),
  ('inst_us_senate', 'legislature', 'U.S. Senate', 'US', 'federal', CURRENT_TIMESTAMP),
  ('inst_uk_commons', 'legislature', 'UK House of Commons', 'GB', 'federal', CURRENT_TIMESTAMP),
  ('inst_uk_lords', 'legislature', 'UK House of Lords', 'GB', 'federal', CURRENT_TIMESTAMP),
  ('inst_ca_commons', 'legislature', 'Canadian House of Commons', 'CA', 'federal', CURRENT_TIMESTAMP),
  ('inst_ca_senate', 'legislature', 'Canadian Senate', 'CA', 'federal', CURRENT_TIMESTAMP),
  ('inst_au_house', 'legislature', 'Australian House of Representatives', 'AU', 'federal', CURRENT_TIMESTAMP),
  ('inst_au_senate', 'legislature', 'Australian Senate', 'AU', 'federal', CURRENT_TIMESTAMP);

-- ============================================================================
-- 3. Migrate representative (CongressionalRep) → decision_maker
--    Table stays — we COPY data, preserving IDs so legislative_action
--    decision_maker_id values can be linked via ExternalId.
-- ============================================================================

INSERT INTO "decision_maker" (
  "id", "type", "title", "name", "first_name", "last_name",
  "party", "jurisdiction", "jurisdiction_level", "district",
  "phone", "email",
  "active",
  "created_at", "updated_at", "institution_id"
)
SELECT
  r."id",
  'legislator',
  CASE
    WHEN r."chamber" = 'senate' THEN 'Senator'
    WHEN r."chamber" = 'house'  THEN 'Representative'
    ELSE NULL
  END,
  r."name",
  -- first_name: everything before the last space
  CASE
    WHEN position(' ' IN r."name") > 0
      THEN left(r."name", length(r."name") - length(substring(r."name" FROM '[^ ]+$')) - 1)
    ELSE NULL
  END,
  -- last_name: last word
  CASE
    WHEN position(' ' IN r."name") > 0
      THEN substring(r."name" FROM '[^ ]+$')
    ELSE r."name"
  END,
  r."party",
  r."state",                -- jurisdiction = state abbreviation
  'federal',                -- all CongressionalRep rows are federal
  r."district",
  r."phone",
  r."email",
  r."is_active",            -- active ← is_active
  r."last_updated",         -- created_at ← last_updated (best available)
  r."last_updated",         -- updated_at ← last_updated
  CASE
    WHEN r."chamber" = 'house'  THEN 'inst_us_house'
    WHEN r."chamber" = 'senate' THEN 'inst_us_senate'
    ELSE NULL
  END
FROM "representative" r;

-- ============================================================================
-- 4. Create ExternalId entries from representative.bioguide_id
-- ============================================================================

INSERT INTO "external_id" ("id", "decision_maker_id", "system", "value", "created_at")
SELECT
  gen_random_uuid()::text,
  r."id",
  'bioguide',
  r."bioguide_id",
  r."last_updated"
FROM "representative" r
WHERE r."bioguide_id" IS NOT NULL;

-- ============================================================================
-- 5. Migrate international_representatives → decision_maker + external_id
--    International reps don't have first/last split — parse from name.
-- ============================================================================

INSERT INTO "decision_maker" (
  "id", "type", "title", "name", "first_name", "last_name",
  "party", "jurisdiction", "jurisdiction_level", "district",
  "phone", "email", "website_url", "photo_url",
  "active", "created_at", "updated_at", "institution_id"
)
SELECT
  ir."id",
  'legislator',
  ir."office",                                             -- title ← office (e.g. "MP")
  ir."name",
  -- first_name: first word
  CASE
    WHEN position(' ' IN ir."name") > 0
      THEN left(ir."name", position(' ' IN ir."name") - 1)
    ELSE NULL
  END,
  -- last_name: everything after first space, or full name
  CASE
    WHEN position(' ' IN ir."name") > 0
      THEN substring(ir."name" FROM position(' ' IN ir."name") + 1)
    ELSE ir."name"
  END,
  ir."party",
  ir."country_code",                                       -- jurisdiction = country code
  'federal',
  ir."constituency_name",                                  -- district ← constituency_name
  ir."phone",
  ir."email",
  ir."website_url",
  ir."photo_url",
  true,
  ir."created_at",
  ir."updated_at",
  CASE                                                     -- institution_id ← chamber mapping
    WHEN ir."country_code" = 'GB' AND ir."chamber" = 'commons' THEN 'inst_uk_commons'
    WHEN ir."country_code" = 'GB' AND ir."chamber" = 'lords'   THEN 'inst_uk_lords'
    WHEN ir."country_code" = 'CA' AND ir."chamber" = 'commons' THEN 'inst_ca_commons'
    WHEN ir."country_code" = 'CA' AND ir."chamber" = 'senate'  THEN 'inst_ca_senate'
    WHEN ir."country_code" = 'AU' AND ir."chamber" = 'house'   THEN 'inst_au_house'
    WHEN ir."country_code" = 'AU' AND ir."chamber" = 'senate'  THEN 'inst_au_senate'
    ELSE NULL
  END
FROM "international_representatives" ir;

-- Create ExternalId entries for constituency IDs
INSERT INTO "external_id" ("id", "decision_maker_id", "system", "value", "created_at")
SELECT
  gen_random_uuid()::text,
  ir."id",
  LOWER(ir."country_code") || '-constituency',
  ir."constituency_id",
  ir."created_at"
FROM "international_representatives" ir
WHERE ir."constituency_id" IS NOT NULL;

-- ============================================================================
-- 6. Add FK from legislative_action.decision_maker_id → decision_maker
--    First, NULL out any orphaned values that don't match a decision_maker row.
-- ============================================================================

UPDATE "legislative_action"
SET "decision_maker_id" = NULL
WHERE "decision_maker_id" IS NOT NULL
  AND "decision_maker_id" NOT IN (SELECT "id" FROM "decision_maker");

ALTER TABLE "legislative_action"
  ADD CONSTRAINT "legislative_action_decision_maker_id_fkey"
  FOREIGN KEY ("decision_maker_id") REFERENCES "decision_maker"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

-- Composite indexes for activity timeline queries
CREATE INDEX "legislative_action_dm_occurred_idx"
  ON "legislative_action"("decision_maker_id", "occurred_at");
-- ============================================================================
-- 7. Drop international_representatives (model removed from schema)
--    The representative table stays — CongressionalRep still uses it.
-- ============================================================================

DROP INDEX IF EXISTS "international_representatives_country_code_idx";
DROP INDEX IF EXISTS "international_representatives_country_code_constituency_id_idx";
DROP TABLE IF EXISTS "international_representatives";

COMMIT;
