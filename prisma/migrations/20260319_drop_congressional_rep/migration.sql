-- Drop legacy CongressionalRep + user_representatives tables
-- These are fully replaced by DecisionMaker + UserDMRelation (Seam 1 resolution)
-- All data was backfilled into the new models via 20260319_user_dm_relation

-- Drop junction table first (depends on representative)
DROP TABLE IF EXISTS "user_representatives" CASCADE;

-- Drop the representative table
DROP TABLE IF EXISTS "representative" CASCADE;
