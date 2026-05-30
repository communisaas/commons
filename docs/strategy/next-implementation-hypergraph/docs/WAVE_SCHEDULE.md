# Wave Schedule

Each wave gate is a hard barrier — predecessor wave's exit criteria MUST hold before downstream tasks start.

## W-0 — Pre-launch ops gate

**Gate**: nothing (initial wave)
**Exit criteria**:
- [ ] NEW-A-1 ABC enrollment approved (Apple-side weeks)
- [ ] NEW-T2-2 ses-proxy Lambda deployed + BLAST_RECEIPTS_SECRET synced
- [ ] NEW-A-4 Sentry on-call wired + BOUNDARY_CELL_RATE_HIGH routes to a human
- [ ] NEW-A-5 first-org staging walk-through complete
- [ ] NEW-A-6 launch-day runbook reviewed
- [ ] NEW-A-7 FEATURES.CONGRESSIONAL=true PR merged

5 tasks total. CP-1 / CP-2 / CP-5 are concurrent — three parallel ops tracks.

## W-1 — First-org launch + substrate cleanup

**Gate**: W-0 exit criteria met
**Exit criteria**:
- [ ] First org runs first verified campaign through the platform (end-to-end)
- [ ] NEW-E-1 userId thread-through (reputation cron has real data)
- [ ] NEW-E-2 atlasVersion thread-through (driftCount/driftPct non-null)
- [ ] NEW-E-3 VerificationPacket.debate populated when debateId set
- [ ] NEW-E-4 brandingAccent renders in CoalitionReport + report email
- [ ] NEW-E-5 AttestationVerifier mounted on /v/[hash]
- [ ] NEW-A-2 MDL_IOS flag flip (iOS Safari lane live)

7 tasks. Five substrate wire-ups are concurrent — one PR or split arbitrarily.

## W-2 — Post-launch hardening

**Gate**: W-1 (first org live, substrate honest)
**Exit criteria** (high-level — see tasks.json for all 37 items):
- [ ] CP-3 mainnet composite deployed (SnapshotAnchor + DistrictRegistry + DebateMarket on Scroll L2)
- [ ] CP-4 TEE Nitro Enclave deployed; NEW-T4-1 delegation executor running
- [ ] Receipt Merkle anchoring pipeline live (NEW-T6-1, NEW-T6-3, NEW-T6-10)
- [ ] DM enrichment + staffer dashboard (NEW-T8-1a, NEW-T8-1b)
- [ ] On-chain stake + LMSR feed (NEW-T5-2, NEW-T5-8)
- [ ] Audit log API + weekly digest wired (NEW-T9-5, NEW-T8-9)
- [ ] Email path hardened (NEW-T1-9, NEW-T2-4, NEW-T2-10)
- [ ] SMS path operational (NEW-T2-1, NEW-T2-8, NEW-T2-9)
- [ ] CRM integration (NEW-T8-5)

37 tasks. Two long parallel branches: mainnet chain (CP-3 → anchor pipeline → archive) and TEE chain (CP-4 → delegation → AI panel → UI).

## W-3 — Phase 2 precision + platform partnerships

**Gate**: W-2 exit criteria met
**Exit criteria**:
- [ ] OpenStates + special districts ingestion (NEW-T3-1, NEW-T3-2)
- [ ] Multi-jurisdiction routing + per-district feeds (NEW-T3-8, NEW-T3-10)
- [ ] Postal Bubble disambiguation UX (NEW-T3-9)
- [ ] Agentic legislative monitoring across 24 boundary types (NEW-T4-4)
- [ ] AN OSDI sync + OSDI namespace (NEW-T1-3, NEW-T9-4)
- [ ] TS + Python SDK publish pipelines (NEW-T9-1, NEW-T9-2)
- [ ] Developer portal (NEW-T9-8)
- [ ] State-bill ingestion (NEW-T6-6)
- [ ] Cross-org reputation + supporter pools (NEW-T7-3, NEW-T7-2)
- [ ] Custom domain + DKIM/DMARC (NEW-T2-6)
- [ ] Embed widget enhancements (NEW-T9-10)

19 tasks. Two concurrent tracks: Phase 2 state-data substrate (TR-C) and platform partnerships (TR-F).

## W-4 — International expansion

**Gate**: W-3 + per-country compliance review
**Exit criteria**:
- [ ] CA / GB / AU rep-lookup wiring (NEW-T3-3, NEW-T3-4, NEW-T3-5)
- [ ] TIGER 2026 monitoring + DOGE/Census resilience playbook (NEW-T3-7)
- [ ] Cross-border campaign schema (NEW-T7-4)
- [ ] Coalition multi-country delivery (NEW-T7-6)

5 tasks. Country resolvers parallel; cross-border schema gates multi-country delivery.
