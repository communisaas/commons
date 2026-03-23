-- B-2: Add privacy-preserving district commitment columns to DistrictCredential
--
-- district_commitment: Poseidon2_sponge_24(districts[0..24]) — circuit-compatible
-- slot_count: how many of the 24 district slots are non-zero
--
-- These columns will eventually replace the plaintext congressional_district,
-- state_senate_district, state_assembly_district columns after all legacy
-- credentials expire (~6 months from migration).

ALTER TABLE "district_credential" ADD COLUMN "district_commitment" TEXT;
ALTER TABLE "district_credential" ADD COLUMN "slot_count" INTEGER;
