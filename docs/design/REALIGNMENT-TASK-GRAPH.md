# Realignment Task Graph

> **Status:** Phases 0–7 ✅ CLOSED for engineering. The cycle-209→348 architectural-rotation sprint is also closed (segment paginated dispatch, TCPA cross-org consent scoping, donations-side sweep cron, V1→V2 AAD single-phase encryption — all shipped). **Remaining work is operational** (Phase 0.5 hard launch gates, user-driven), **substrate-blocked** (Phase 6 VerificationPacket), or **deferred-architectural** (F-125 path A, post-launch). All resolved findings + closed-phase detail + completed-cycle forensics have been pruned from this document — full history recoverable via `git log -p docs/design/REALIGNMENT-TASK-GRAPH.md`. The findings table below carries only items that are still open or deferred-with-rationale.
> **Last updated:** 2026-05-11 (second cleanup; first was 2026-05-09)
> **Thesis:** Commons-as-commons (see `memory/design_realignment_2026_05.md`)

---

## How this document works

- **Active phase** is detailed in full. Sub-tasks track status: `pending` → `in-progress` → `review` → `done`.
- **Upcoming phases** carry only summary scope until they become active.
- **Findings log** records open + persistent-deferred brutalist-review findings (BLOCKER/REGRESSION/DRIFT) with disposition. Resolved findings are pruned at cleanup cycles.
- **Decisions log** records irreversible or substrate-affecting calls, dated.

---

## Conventions

**Brutalist review modes:**
- `roast` — single-critic for narrow technical work.
- `roast_cli_debate` — multi-critic (default 3-5) for principle-aligned design work.
- `+specialist` — domain expert added when surface needs it (cryptographic correctness, accessibility, plain-English voice).

**Severity ladder:**
- **BLOCKER** — violates one of the nine principles or breaks federation/permanence. Cannot ship.
- **REGRESSION** — undoes work from a prior aligned phase. Cannot ship without explicit waiver.
- **DRIFT** — leaks SaaS register, marketing voice, or US-Congressional substrate-lock. Must be addressed before phase closes.
- **ADVISORY** — nice-to-have. Logged, deferred to Phase 8 sweep.

**Default exit criterion:** zero BLOCKERs, zero REGRESSIONs, all DRIFTs addressed or explicitly waived with reasoning recorded in Findings log.

**Phase gating:** strict. A phase cannot begin until its predecessor's exit criterion is met.

---

## The nine generative principles (audit lens)

**Substrate** — 1) math is the only authority; 2) federation-ready by default; 3) permanence over product cycles.
**Artifact** — 4) verifiable or honestly interpretive; 5) information has shape, express the shape; 6) cryptographic substrate visible as registry marks.
**Commons** — 7) plurality encoded, not curated; 8) decision-makers and constitutional moments share the substrate; 9) plain English, universally legible.

---

## Active work

### Phase 0.5 — Pre-launch ops + hard launch gates (USER-DRIVEN)

**Goal:** close Phase 0 follow-up items that gate launch. Phase 0.5 does NOT block design work, but launch is hard-gated by Phase 0.5 close. Mostly operational + counsel work, not engineering. ~2-4 weeks elapsed (much of it Apple-side / USPTO-side / counsel-side).

**Critical context (from brutalist do-5 review):** Several Phase 0 cures (the stewardship license, the SFC fallback, the standing offer of arbitration) are textually present in `voter-protocol/GOVERNANCE.md` but operationally unfunded. Phase 0.5 closes the operational dependencies. PBC has explicitly committed in GOVERNANCE.md not to launch as canonical-reference-implementation without these closing.

#### HARD LAUNCH GATES (block launch — must close before substrate is canonical)

- **F-59 — Escrow-agent acceptance.** Secure written acceptance from Software Freedom Conservancy (or accepted alternative — Open Source Initiative, Open Source Collective, Code for Science & Society) to serve as escrow agent under §"Change of control" *Designated escrow agent*. Acceptance published as `voter-protocol/specs/ESCROW-ACCEPTANCE.md`. Without this, the change-of-control fallback is non-functional.
- **EMERITUS-CHARTER.md publication + 5 named signers.** Required by §"Change of control" *Primary successor*. Charter must enumerate duties, quarterly fee, indemnification scope, easy-resignation procedure, dispute-reserve fund (initial endowment + replenishment + draw procedure). Five signers must satisfy insider-conflict rule (with launch-period exemption: up to 2-of-5 may be recently-former contractors per F-46 carve-out for first 24 months). Without this, multisig is unconstituted; succession runs only via escrow fallback.
- **F-37 / F-48 — COI amendment + binding stockholder voting agreement.** PBC amends Certificate of Incorporation to require 2/3 stockholder vote for §362(a)(1) deletion. Until filed with Delaware SOS and dated, the supermajority assumption in §"Dissolution" is aspirational. UPGRADE: also execute a binding stockholder voting agreement immediately (not waiting for COI amendment), committing current stockholders to vote against any §362(a)(1) deletion that doesn't satisfy 2/3 + 90-day peer notice. Voting agreement is enforceable as contract among signing stockholders even before COI amendment lands.
- **F-38 — USPTO trademark filings.** Verify "VOTER Protocol" and "Communiqué" USPTO registration status. If unregistered, file Section 1(b) intent-to-use applications for BOTH marks before launch. Without this, succession trademark transfer is mostly vapor and a hostile fork can dilute the marks.
- **F-52 — Signed launch-date manifest.** All 12-month / 24-month deadlines in GOVERNANCE.md (transition sunset, dispute-resolution sunset, insider-conflict launch-period exemption) reference "launch date in `specs/CRYPTOGRAPHY-SPEC.md` §0". §0 currently records only the 2026-05-05 namespace migration date. Publish a signed launch manifest naming the launch date and reference it from §0 + GOVERNANCE.md.
- **F-34 — Signed deployment manifest.** `voter-protocol/contracts/DEPLOYED.json` listing each deployed contract address on Scroll L2, constructor arguments used, on-chain timelock values from `governance()` view, and `scripts/verify-deployment.ts` that any third party can run against a public RPC to confirm the manifest matches on-chain reality.
- **0a follow-up commands (user-run, blocks deployment manifest).** Noir circuit recompile + key regen for new namespace constants; cross-language golden vectors test (`pnpm test sponge-vectors three-tree-golden-vectors golden-vectors` in `packages/crypto`); Solidity verifier rebuild + testnet redeploy (do NOT push mainnet — 14-day timelock); commons unit tests + Solidity revocation tests.
- **Apple Business Connect enrollment** (ops, weeks-long Apple-side process for iOS Safari mDL flow).
- **`FEATURES.CONGRESSIONAL = true` PR** (current default off; flip on launch).
- **G3 measurement on launch state(s)** — CA done; non-CA needs script run + threshold re-tune.
- **First-org staging walk-through end-to-end.**

#### SOFT GATES (block launch but lower architectural risk)

- **F-33 — `conduct@commons.email` mailbox verification.** Confirm mailbox routes to designated CoC-handler humans (not founder inbox).
- **Production `REDIS_URL` provisioned + smoke** (rate limiter throws at boot if unset).
- **Sentry on-call wiring** (confirm `BOUNDARY_CELL_RATE_HIGH` reaches a human).
- **Launch-day runbook** (resolver hang, mDL break, boundary spike, atlas read failure).
- **F-63 ✅ CURED (cycle 87).** `voter-protocol/.github/workflows/license-grant-trailer.yml` runs on every PR and fails when a commit touching `specs/`, `GOVERNANCE.md`, `README.md`, `ARCHITECTURE.md`, `CONTRIBUTING.md`, or LICENSE files lacks the `License-grant: Apache-2.0 OR CC-BY-4.0` trailer. Uses git's `%(trailers:key=License-grant,valueonly)` parser. Path matching is exact for filenames, prefix-only for `specs/` directory. CONTRIBUTING.md updated to document the workflow + the amend procedure (`git commit --amend` / `git rebase -i <base>` reword). Maintainers retain merge authority via branch protection — the workflow is evidentiary per CONTRIBUTING's default-fallback policy. Bash logic dry-run validated against real spec-touching commit (`c3231026` — correctly identified as missing-trailer; existing main-branch commits don't carry the trailer, so contributor discipline begins forward).
- **F-125 ops gate — `BLAST_DISPATCH_SECRET` on SvelteKit + Lambda.** Without the env var on both sides, F-125 caller-cohort validation is not enforced (Lambda 503s on missing secret per cycle-20 fail-closed contract; SvelteKit endpoint 503s too). Generate a 32-byte random secret, mirror to both runtimes, document rotation procedure.
- **F-128 ops gate — `BLAST_RECEIPTS_SECRET` on Convex + Lambda + `CONVEX_RECEIPTS_URL` on Lambda.** Without these, the Lambda's durable receipt forward is inactive (browser-side write remains the only path; F-128's "browser-disconnect mid-blast" gap remains open).
- **All Phase 0.5 launch-gate env vars set per `.env.example`** (cycle 37/39 added: `BLAST_DISPATCH_SECRET`, `BLAST_RECEIPTS_SECRET`, `UNSUBSCRIBE_SECRET`, `ORG_KEY_WRAPPING_KEY`, `PSEUDONYMOUS_ID_SALT` — must mirror to Convex env, `SESSION_CREATION_SECRET`, `EXPECTED_CELL_MAP_ROOT` + `_DEPTH`, `ADMIN_USER_IDS`, `REJECTION_MONITOR_WEBHOOK_URL` + `_THRESHOLD_PERCENT`, `COMMONS_INTERNAL_URL`, `TEE_RESOLVER_URL`, `ENCLAVE_PARENT_HOST`, `FEATURE_CONGRESSIONAL`, `CONGRESSIONAL_DELIVERY_LAUNCHED`, `CONVEX_SITE_URL`).

**Lens:** anything reliance-party-facing (escrow acceptance, charter, COI, USPTO, deployment manifest, launch manifest) must be third-party-verifiable from the repo + public records. If a peer or auditor cannot verify it without contacting Communiqué PBC, it doesn't count.

---

### Phase 6 — Cryptographic visibility pass

**Status:** ✅ CLOSED for engineering (6/7: 4 shipped + 2 deferred-with-rationale). **One surface remains substrate-blocked.**

#### Remaining surface

- ⏸ **`VerificationPacket` audit drawer** — Drawer shows substrate *labels* (`user_root`, `cell_map_root`, `engagement_root`) using `<code>` placeholders not actual hashes. Real values require those registries deployed; currently only `revocation` tree exists in `smtRoots`. Revisit once the action-tree work lands.

#### Closed-by-deferral (no further action pre-launch)

- ✅ `AttestationFooter` (cycle closure 2026-05-07): no per-action proof exists at compose time; per-action citation correctly lives on the post-send receipt (`ProofGenerator` complete state with `nullifierHex` `<RegistryMark variant="nullifier" truncate>`).
- ✅ Atlas root CID footer (cycle 33 closure): manifest `currentRoot` was *intentionally* deferred until on-chain `DistrictRegistry` (Scroll L2) ships in J-phase per `voter-protocol/specs/H-PHASE-SCOPE.md` §6 + `I-PHASE-SCOPE.md` §2 / I0r correction. Pre-anchor `currentRoot` would be theatre.

---

### Phase 8 — Codebase propagation sweep (ongoing)

**Status:** Active for low-severity post-launch hygiene. Most major sweeps closed via cycles 11-58 (commit history records detail). Remaining items are non-gating.

#### Persistent open / accepted-deferred

- **F-94 (MEDIUM, accepted-deferred):** `totalStake: v.number()` on debates may corrupt past 2^53. Mitigation: `totalStake` omitted from deliberation-index render, so no user-visible truncation can occur. Re-open as a cure cycle when stake markets graduate beyond research mode and uniform stringification across all reads is feasible.
- **F-125 path A (deferred, post-launch architectural):** full server-mediated bulk send (eliminate browser-direct STS path entirely). Multi-cycle architectural refactor. Path B (caller-cohort validation via dispatch-claim) is the active defense and is sufficient pre-launch.
- **F-146 (LOW, cheap-correct cure shipped, deeper cure deferred):** `donorCount` schema field counts completed donations, not unique donors. UI relabeled to "Donations" + per-donation average semantics documented. True unique-donor tracking deferred — would need composite `(campaignId, supporterId)` index + refund-aware decrement logic.

#### Cured findings (one-line tombstones; forensic detail in git log)

- **F-147 ✅ CURED:** ~33 POST/PATCH endpoints + ~11 form-action boundaries + Bearer-authed v1 API + residual HTTP routes + token-bearing route param caps all bounded. Defense-in-depth pattern at the SvelteKit boundary before invoking Convex/Stripe/Groq/Pimlico/Shadow-Atlas/Gemini paths. Caps follow realistic sizes (emails ≤254, names ≤200, blobs ≤64KB, BN254 hex ≤80, Convex doc ids ≤64). Self-audit pass switched verify-address from silent-drop to throw-400 for consistency.
- **F-148 ✅ CURED:** public `subscriptions.cancel` Stripe-desync risk — refuses direct-cancel when `sub.stripeSubscriptionId` is set; production cancellation flows through Stripe billing portal → webhook.
- **F-149 ✅ CURED:** all 12 Convex `action()` exports input-bounded across submissions, donations, delegation, campaigns, events, invites, organizations, segments, supporters, templates, legislation. Closure cycle also caught + fixed a real bug where `/api/delegation` had been validating array-typed args as scalars (every legitimate client request had been 400'ing).
- **F-150 ✅ CURED:** ~199 stale type casts (mostly `as any` doc-id casts) eliminated across `src/routes/`, `src/lib/`, and `convex/` — replaced with proper `Id<'tableName'>` typing. Convex `as any` count: ~83 → 15 (surviving 15 are framework-bound: `normalizeId`, generic patch helpers, `FunctionReference` type-erasure, paginator cursor quirk, public-API cascade-blocked supporters.tagId, `v.any()`-typed seed rows, dynamic-table queries). Brutalist self-review during sweep surfaced + cured 3 real production bugs (F-151, F-152, F-153).
- **F-151 ✅ CURED:** debate settle endpoint's campaign-linkage check was always tripping — cast hid that `debates.get` doesn't return a `campaign` field. Org admins could never settle a debate. Cured by adding `getCampaignByDebateId` reverse-index query and switching arguments lookup to `listArguments({stance, limit:1})`.
- **F-152 ✅ CURED:** `batchRegisterDeliveries` mutation was missing the schema-required `recipientName` field on its `positionDeliveries` insert — cast erased field-shape knowledge; Convex runtime validator would reject every call. Cured by adding `recipientName: r.name` to the insert.
- **F-153 ✅ CURED:** segment-filter `engagementTier` case read a non-existent supporter field. Server-side rewritten as no-op pass-through; UI dropdown labels the option `"Engagement Tier (legacy)"` to discourage new use while preserving render of saved segments. Real aggregate-from-actions cure deferred to when the metric is actively surfaced.
- **F-157 ✅ CURED:** SvelteKit↔Convex internal-function trust boundary. `serverInternalQuery/Mutation/Action` in `src/lib/server/convex-internal.ts` cast `internalQuery/Mutation/Action` refs to public and routed through `ConvexHttpClient`, which only resolves public exports — every call failed at runtime with "Could not find public function." Cure: ~50 internal functions across `email.ts`, `v1api.ts`, `revocations.ts`, `users.ts`, `submissions.ts`, `subscriptions.ts`, `debates.ts`, `events.ts`, `resolvedContacts.ts` converted to public `query/mutation/action` with `_secret: v.string()` arg + `requireInternalSecret()` gate in `convex/_internalAuth.ts` (constant-time compare, dual-secret rotation matching cycle-195). SvelteKit side reads via new `getInternalSecret()` helper in `secret-auth.ts`. 4 dual-called functions (`subscriptions.checkPlanLimitsByOrgId`, `revocations.setRevocationHalt`, `debates.insertDebate`, `events.getEventInternal`) kept their internal versions for in-Convex `ctx.runQuery` callers and gained sibling `*ForCaller` public wrappers. The intermediate proxy band-aid (`convex/internalProxy.ts` from earlier in the same session) was deleted alongside the broken helpers. Smoke confirms: V1 fake bearer → 401, wrong secret → Unauthorized, valid secret + valid args → success.
- **Planning-residue cleanup ✅ COMPLETE:** scrubbed all planning-cycle / project-phase / project-wave / F-NNN-finding markers from source code per the no-planning-residue feedback rule. ~70 source files + tests/ + infra/lambda/ + config files. Substantive rationale preserved. Crypto-spec audit identifiers (FU-X.Y, F-1.X, KG-N) intentionally retained — those name stable spec items.

#### Track A — pre-launch ops (user-driven, see Phase 0.5 above)

#### Track B — J-phase post-launch hardening (engineering, not gating)

- TEE Nitro Enclave deployment + `NitroEnclaveResolver` wiring (interface stub from G4 exists)
- TEE kill-switch + multi-region (depends on Nitro)
- On-chain `DistrictRegistry` (Scroll L2) + manifest `currentRoot` (bundled — `currentRoot` standalone is theatre)
- Merkle h3Index inclusion proofs (residual atlas-operator-trust closure)
- `TEE_RESOLVER_URL` ↔ `TEE_PUBLIC_KEY_URL` collapse (depends on Nitro)

#### Track C — Phase 2 (post-launch precision)

ACS population layer, density-aware K-anonymity, SLDU/SLDL expansion, multi-state G3, CT BAF/TIGER vintage shim if CT launches.

#### Track D — international (post-Phase-2)

CA/GB/AU country resolvers (currently stubs).

#### Track E/F — process + non-blocking gaps

- Comprehension testing on each UI change (PR-checklist line)
- SimpleAccount factory not populated for NEAR gasless ERC-4337 path
- SMS recipient filtering (`smsStatus` field exists but segment query not wired for phone filtering)
- Stripe metered overage billing (hard block sufficient until first org exceeds plan limit)
- Client storage per-user keying ✅ CURED. Logout sweeps four localStorage prefixes (`commons`, `analytics_`, `viewed:`, `acted:`); trade preimages live in IndexedDB store `commons-trade-preimages-v2` keyed by `[userAddress, debateId, epoch]`; `commons-credentials` is HMAC(userId)-keyed at rest. Forensic detail in git log.
- PASSKEY flag (currently `false`)

---

## Findings log

> **Cleanup banner (2026-05-09 cycle 58):** All resolved findings (F-01 through F-145 except those listed below) have been pruned. The cleanup is forensically traceable via `git log` on this file + the PR/commit history of the cycle that closed each finding. Each currently-listed entry is either OPEN or accepted-deferred-with-rationale.

| ID | Date | Phase | Severity | Finding | Disposition | Reference |
|----|------|-------|----------|---------|-------------|-----------|
| F-35 | 2026-05-05 | 0c | DRIFT (forward-looking) | GuardianShield is described in code (`MIN_GUARDIANS = 2`) but no guardians are recruited and the abstract base is not yet inherited by any deployed registry. GOVERNANCE.md inventory flags "not yet active" honestly but the framing is forward-looking. | ✅ CURED (cycle 214). Took the "remove from inventory until inherited" path: dropped GuardianShield row from the active privileged-roles table at `voter-protocol/GOVERNANCE.md:88-91` and moved it to a new "Planned but not yet active" subsection that names it as not-on-chain-today, not in the trust analysis, and contingent on wiring + recruitment before it counts. The bullet-point description at line 70 was also tightened to point at the new subsection instead of the table. Reliance parties reading the inventory now see only contracts that actually carry on-chain authority. | discovered during 0c do-2 |
| F-36 | 2026-05-05 | 0c | ADVISORY | Recursive definition: transition gate (1) defines "independent peer" via 90-day non-PBC-key activity; conflict-resolution "contested" relies on same concept. If no peer ever clears gate (1), contested-proposal protections never activate. | ✅ CURED (cycle 215). Took the "accept as known limitation" path. Verified the contested-proposal definition (line 201) ALREADY admits "independent security researcher unaffiliated with Communiqué PBC" via OR-clause — so contested-proposal protections do activate pre-peer. The remaining recursion is on the **standing offer of arbitration** (§"Standing offer", line 190): currently only peer operators can invoke. Cure: added "Honest acknowledgment of the pre-peer recursion" subsection at `voter-protocol/GOVERNANCE.md` after the 12-month progress paragraph that names the gap explicitly, names the existing backstops (24-month sunset under *Conflict resolution* item 4, plus the public Apache-2.0/CC-BY-4.0 substrate licenses), and explains why extending the standing offer pre-peer is not done unilaterally (would itself be a governance defect — must go through spec-change process). Reliance parties now see the limit named, not papered over. | discovered during 0c do-2 |
| F-38 | 2026-05-05 | 0c | DRIFT (HARD LAUNCH GATE) | "VOTER Protocol" and "Communiqué" trademark registration status with USPTO is unknown. TRADEMARK.md, NOTICE, and GOVERNANCE.md succession sections rely on trademark transferability — for unregistered common-law marks this is mostly vapor and a hostile fork can dilute the mark before any transfer completes. | Open — Phase 0.5 ops gate: confirm USPTO status; if unregistered, file Section 1(b) intent-to-use for both marks before launch. | brutalist roast 2026-05-05 |
| F-48 | 2026-05-05 | 0c | REGRESSION (HARD LAUNCH GATE) | F-37 §242(b)(1) recommendation that PBC SHALL amend COI for 2/3 supermajority is non-binding until COI is filed with Delaware SOS. Until then, founders/investors can drop PBC status with simple majority. Acquirer engineers §362(a)(1) deletion before triggering change-of-control; succession clause bypassed. | Open — Phase 0.5 ops gate (already F-37 disposition). UPGRADE: also recommend a binding **stockholder voting agreement** executed immediately (not waiting for COI amendment), committing current stockholders to vote against any §362(a)(1) deletion that doesn't satisfy 2/3 threshold + 90-day peer notice. | brutalist final sweep 2026-05-05 (Gemini REGRESSION 3) |
| F-94 | 2026-05-07 | 5c | MEDIUM (accepted-deferred) | `totalStake: v.number()` will silently corrupt past 2^53 when stake markets get serious. `listAwaitingGovernance` already does `d.totalStake?.toString() ?? "0"` correctly. | ✅ ACCEPTED-DEFERRED via Phase 8 cycle 33 with mitigation noted: `totalStake` is omitted from deliberation-index render so no user-visible truncation can happen until uniform stringification across all reads. Re-open as a cure cycle when stake markets graduate beyond research mode. | brutalist roast 2026-05-07 (Claude MEDIUM, accepted) |
| F-125 (path A) | 2026-05-07 | 7 | DEFERRED (post-launch architectural) | Full server-mediated bulk send (eliminate browser-direct STS path entirely). Multi-cycle architectural refactor. | Path B (cycle 20: caller-cohort validation via dispatch-claim) is the active defense; sufficient pre-launch. Path A is post-launch hardening. | brutalist roast 2026-05-07 (Codex F4 do-3) |
| F-156 (cycle-251 F3) | 2026-05-10 | 8 | DEFERRED (post-launch architectural) | STS credentials issued to the BROWSER via `/api/org/[slug]/ses-token` can be used directly against SES, bypassing the Lambda dispatch-claim gate. Session policy restricts only `ses:FromAddress`; a compromised editor browser (XSS, extension) can send to any recipient within 15 minutes without invoking the Lambda or its dispatch claim. Same root cause as F-125 path A. | Inline SECURITY NOTE comment added at the STS issuance point (`/api/org/[slug]/ses-token/+server.ts`) so future engineers immediately see the limitation. The architectural fix is to move STS issuance Lambda-side and route the browser through `/api/blast/[blastId]/dispatch` — same scope as F-125 path A. Cycle 252's MAX_RETRIES gate + cycle 254's modal-state-reset close other amplification vectors. | brutalist roast 2026-05-10 (Codex F3) |

---

## Decisions log

| Date | Decision | Rationale | Reversible? |
|------|----------|-----------|-------------|
| 2026-05-04 | Thesis: building the commons (verified plural commons, Ostrom-aligned) | Substrate, not product. Federation-ready, math-as-authority. | Yes (philosophy) |
| 2026-05-05 | Keep Satoshi + JetBrains Mono pairing | Equity in existing system; adequate institutional register at display scale | Yes |
| 2026-05-05 | Migrate FROZEN crypto strings `commons-*` → `voter-protocol-*` PRE-LAUNCH | Decouple brand from substrate before strings become immutable | **No (post-launch)** |
| 2026-05-05 | GitHub org stays at `communisaas`; protocol-org separation deferred | Move forward without org-mint blocker; revisit post-launch | Yes |
| 2026-05-05 | Strict gates between phases | Each phase's exit criterion must be met before successor begins | Yes |
| 2026-05-05 | Default `roast_cli_debate` critic count: 3-5 | Balance finding density with cycle speed | Yes |
| 2026-05-05 | Task graph persisted at `docs/design/REALIGNMENT-TASK-GRAPH.md` | Living doc; team-discoverable; complements memory | Yes |
| 2026-05-05 | F-14 license: dual `CC-BY-4.0 OR Apache-2.0` at recipient's election for specs/ | Brutalist consensus (Claude+Codex 2/3); ShareAlike viral clause hostile to peer adoption; Apache half cures patent posture for executable algorithms; CC-BY half preserves academic citation. Path-dependent: must decide before external contributors accumulate (DCO grants no relicensing rights — F-39). | **No (post-launch lock-in once external contributors merge)** |
| 2026-05-05 | 0c-D1: Transition sunset = 24 months post-launch + binding 12-month progress report | Brutalist consensus (2/3); aligns TRUST-MODEL §7 ossification timeline; report exposes drift early without auto-trigger consequence | Yes (date can be extended via spec-change process) |
| 2026-05-05 | 0c-D2/D3: Successor entity = 3-of-5 emeritus maintainers multisig + court-supervised escrow fallback | Pragmatic — doesn't require pre-launch foundation diplomacy. D2 = D3 prevents structuring loophole (acquirer dissolves to bypass change-of-control). EMERITUS-CHARTER.md is Phase 0.5 deliverable. | Yes (foundation amendment via spec-change process if SFC/etc. accepts) |
| 2026-05-05 | 0c-D4: Neutral arbiter = JAMS streamlined-arbitration with fee-shifting + dispute-reserve fund | Most enforceable; fee-shift addresses peer cost concern; dispute-reserve fund advances costs for resource-constrained challengers. Arbiter must satisfy insider-conflict rule (F-40). | Yes (replaceable in future spec amendment) |
| 2026-05-05 | 0c-D5: Dispute-resolution sunset coupled to D1 (24 months) + cases-pending carve-out | Coupled-earlier creates premature gap; decoupled-later (36mo) extends PBC mandate. Cases-pending carve-out resolves cliff concern: disputes filed before sunset complete under filing-time rules. | Yes |
| 2026-05-05 | F-37: GOVERNANCE.md cites DGCL §242(b)(1) majority threshold honestly; recommends COI amendment for 2/3 supermajority | Citation accuracy: §363(c) was repealed by Delaware HB 341 (2020). Doc's prior reliance-party promise was unenforceable as written. | Yes (citation can be updated; COI amendment is operational, Phase 0.5 ops gate) |
| 2026-05-05 | F-40: Insider-conflict rule extends to all named third parties (auditor, arbiter, emeritus signers, foundation contacts) | Brutalist consensus; otherwise cleanest acquisition-capture is hire-the-disputant. Codified as new GOVERNANCE.md §"Insider-conflict rule (cross-cutting)". | Yes (rule can be amended via spec-change process) |
| 2026-05-05 | Phase 0 closes at do-5 with stopping rule | Brutalist do-3 → do-4 → do-5 surfaced progressively-architectural defects. Remaining defects (charter not published, signers not named, SFC not contacted, COI not amended, marks not filed) are OPERATIONAL — drafting cannot cure them. Phase 0 closes; Phase 0.5 elevated to "hard launch gate" status. | **No (closing decision)** |
| 2026-05-09 | First cleanup: prune resolved findings + closed-phase detail + completed-cycle log from this document | The doc had grown to 930 lines, mostly forensic. Forensics live in git history; this doc keeps only what remains to be done. Closed phases → header status only. Resolved findings → header banner + git history. Completed-cycle log → deleted entirely. | Yes (history is recoverable) |
| 2026-05-11 | Second cleanup: prune the cycles 192-348 architectural-rotation sprint forensics following the same precedent | Doc had re-grown to 429 lines after the cycle 209→348 sprint shipped 4 architectural items (segment paginated dispatch, TCPA scoping, donations sweep, V2 AAD scheme). Same justification: the cures are landed in code; full forensic detail in `git log -p` + commit history; this doc keeps only open work + load-bearing decisions. | Yes (history is recoverable) |

---

## Recently shipped

> Cycles 27-58 (2026-05-07 to 2026-05-09) + cycles 192-348 (2026-05-09 to 2026-05-11) shipped the architectural work landed in code. Forensic detail recoverable via `git log -p docs/design/REALIGNMENT-TASK-GRAPH.md` and commit history. The cycle 192-348 sprint closed four architectural items in particular:

> 1. Segment paginated dispatch — `countMatching`/`bulkApplyTag`/`bulkRemoveTag`/`exportMatching` converted from bounded-`.take(10K)` queries/mutations to action+paginated-internal-query dispatch.
> 2. TCPA cross-org consent scoping — `orgTwilioNumbers` registry + Twilio `To` capture; START scopes to the org that owns the destination number, STOP stays cross-org.
> 3. Donations-side sweep cron — parallels the supporters sweep; reuses the `sweepCheckpoints` cross-tick cursor primitive.
> 4. V1→V2 AAD encryption scheme — `encryptForSupporterV2` anchors AAD on `eh:${emailHash}` so single-phase encrypt-then-insert is possible; `decryptOrgPii` dispatcher routes v=org-1 (legacy) and v=org-2 (new) blobs transparently.

> Planning-residue scrub completed 2026-05-11: source files + tests now speak from engineering only — no Cycle/F-NN/brutalist references remain in `convex/`, `src/`, or `tests/` across commons + voter-protocol.


*Maintained 2026-05-04 → present. See also `memory/design_realignment_2026_05.md` and `voter-protocol/specs/CRYPTOGRAPHY-SPEC.md`.*
