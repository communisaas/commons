-- B-1: Null out Tier 2-only identity commitments
--
-- These were generated from userId+district (not person-bound) and produce
-- invalid nullifiers in the three-tree circuit. Same person with two OAuth
-- accounts would get two different commitments.
--
-- Affected users retain trust_tier=2 and district_verified=true.
-- When they later verify via mDL (Tier 3+), they get a proper person-bound
-- commitment from identity-binding.ts.
--
-- Detection: identity_commitment IS NOT NULL but no Tier 3+ verification
-- markers (document_type and identity_hash are both NULL).

UPDATE "user"
SET identity_commitment = NULL
WHERE identity_commitment IS NOT NULL
  AND document_type IS NULL
  AND identity_hash IS NULL;
