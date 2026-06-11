# Org Capability Scope — May 2026

> **Date:** 2026-05-27
> **Method:** 9 parallel agent-driven code inspection passes across the full org surface
> **Source of truth:** Convex backend + SvelteKit routes + voter-protocol contracts (pre-commit state on `main`)
> **Status legend:** ✅ Shipped (production) | 🟡 Partial (works, gaps noted) | 🟠 Stubbed (schema/UI exists, impl missing) | 🔵 Architecture-ready, not user-facing | 🔴 Missing entirely
> **2026-06-02 reconciliation:** T7-1 coalition aggregate stats are no longer a 501. Public v1 stats and the org-facing coalition report route now call `convex/networks.getStats`; broader coalition data portability remains partial.
> **2026-06-03 reconciliation:** T5-1 auto-debate-spawn is no longer a 501. Verified action threshold crossing schedules `internal.debates.atomicSpawnIfEligible`, and the manual campaign debate route calls `debates.forceSpawnDebateForCampaign`; on-chain stake verification, active mainnet market economics, and TEE-attested verdicts remain partial/gated.
> **2026-06-04 reconciliation:** T1-9 workflow step verbs are implemented. `send_email` runs through a single-supporter SES/org-key path when dependencies are configured, while email-bearing workflow enablement remains dependency-checked through `workflow_email_dependency_missing`; the remaining blocker is runtime confidence, not missing `send_email`/tag step code.
> **2026-06-04 reconciliation:** T2-4 List-Unsubscribe header substrate is implemented through SES v2 `Simple.Headers` on the Convex server path. T2-4b now tracks the separate Gmail/Yahoo mailbox-rendering verification.
> **2026-06-05 reconciliation:** The stale Convex HTTP `/api/v1/supporters` and `/api/v1/campaigns` `501` placeholders are closed. Those Convex-hosted paths now issue method-preserving canonical redirects to the Commons application origin, where the live SvelteKit public API enforces feature gates, API-key auth, scopes, and plan limits.

## Purpose

This doc is a point-in-time, code-grounded inventory of the org-layer capability surface. It exists because (a) `docs/implementation-status.md` and `docs/strategy/product-roadmap.md` claim "Phase 0-2 COMPLETE" while several Phase 2 features have stubbed execution paths, and (b) `src/routes/org/[slug]/settings/+page.svelte:170` lists pricing-tier features that have no implementation. The intent is to align what we say is shipped with what code actually does, and to make the closure path explicit.

A 9-agent inspection pass on 2026-05-27 walked the codebase looking at file paths, function bodies, schema fields, feature flags, and recent memory entries. Each agent classified every capability in its lane as ✅/🟡/🟠/🔵/🔴 with file:line citations. This document is the consolidated output.

## Headline findings

The org layer is **substantially built** (~7,700 LOC org-side, plus the foundation in voter-protocol). The verification substrate works end-to-end: GDS, ALD, temporal entropy, burst velocity, and CAI are computed and rendered; coordination integrity surfaces correctly; campaign reports render with cryptographic attestation hashes; SES delivery tracking with sesMessageId correlation works; mDL Android OID4VP is production-grade including HPKE decrypt, COSE_Sign1 against IACA roots, and I1 SessionTranscript binding; the three-tree ZK circuit runs in browser WASM; 858 Foundry tests pass on Scroll Sepolia; SnapshotAnchor has a live `updateSnapshot()` transaction anchoring atlas v20260512.

The capability surface still has **explicit stub boundaries** — unsupported-step logs, ops-gated stubs, or hardcoded/TODO guards where code intentionally short-circuits. These are not abstract gaps; they are searchable file:line locations that must stay visually downgraded until the stronger capability is armed.

The capability surface has **~30 additional partial gaps** — features where schema and UI exist but functionality is incomplete (e.g., donor confirmation is baseline/config-dependent rather than tax or anchored receipt proof; coordination-score history has no time-series surface; large/no-key email paths still create drafts instead of server-side sends).

Several pricing-tier features (custom domain, SQL mirror, white-label, cross-org supporter sharing/permissioning) have no implementation. The settings comparison grid now marks these as gated or partial capability rows instead of presenting them as armed tier benefits.

The Studio Capability map is now an operational instrument rather than a route inventory. It renders workspace posture, operating readout, **Capability state ledger**, **Capability coverage** for the nine canonical clusters, Next moves, launch vector, compound paths, launch pressure, claim boundary, loop/lattice rows, route-level readiness matrices, operator queue, claim basis, critical path, gate register, and send readiness from shared readiness builders, real loaded org slices, runtime flags, and task/data hypergraph evidence. The first-scan headline names Commons rather than the implementation metaphor "OS"; workspace posture renders a `Datum`-backed workspace count plus armed/bounded/held state mix from `workspacePostureStateCounts`, while posture and operating readout cards show compact **Ground** and **Next** readouts preserving the full gate/effect contract in accessible text and deeper audit rows. The persistent Mantle uses the same compression rule: workspace marks now visibly render a shared-axis handoff/effect/action/next rail with state-coded dashed boundaries for held marks, while Substrate rows render compact `posturePressureSignal` and `gateSignal` status; full gate evidence stays in title/ARIA and Studio/route audit surfaces. Its draft-only posture pressure consumes `buildSendReadiness` held-mode summary, first held mode, and send-boundary summary rather than maintaining a separate hand-authored email/SMS/workflow/congressional gate list in the layout. The state ledger derives armed/bounded/draft-only/not-armed counts from visible contracts and names one representative handoff, route effect, source, action grammar, and gate for each state. Its header renders compact state / handoff / effect / gate axis labels instead of explainer prose. Its visible-contract source list now includes the first-scan posture/readout/Next-move/launch-vector/claim-boundary/loop-pressure contracts as well as route/readiness rows, launch pressure, critical path, gate register, and claim basis. The Operating posture header renders the same visible-contract state mix as compact audited values, while Operational shifts renders incumbent / Commons / gate axis labels and a pressure rail for grounded lift, qualified lift, and next lift derived only from the `capabilityShifts` state mix plus the first gated/draft/partial row; neither section uses visible explainer copy to describe how to read the map. The Compound moves section renders compound ground, held phase, and next lift pressure cells from `compositionPaths`, phase-step states, and weakest gates before the path cards, so action-to-proof, proof-bound people, coalition packets, and delegated civic action read as system paths rather than a prose explanation. Compound People and Power steps inherit the same shared readiness contracts as first-scan cards and loop phases, so those paths cannot reintroduce raw People counts, followed-target shortcuts, or hardcoded bounded states. The Claim boundary section renders Claimable ground, Qualifier load, and Blocked claim pressure cells from `claimBoundaries` before the detailed claim rows and claim grammar, so the strongest language, required qualifiers, and forbidden claims are visible as stateful instruments. The Gate register section renders Open gates, Load-bearing gate, and Completed ground pressure cells from `summarizeGateRegister` before the detailed gate rows, so source chokepoints and blocked verbs read as current operating pressure rather than task prose. The Send readiness section renders Usable send, Held send, and Next send lift pressure cells from `buildSendReadiness` / `sendPressureReadouts` before the mode rows and compact mode / state / handoff / gate axis labels, so channel side effects read as current readiness pressure rather than send-button copy. Event-artifact shift, runtime claim-basis, and queue rows consume that same event send-mode contract (`eventArtifactMode`) while keeping the `EVENTS` flag only as audit evidence. Coalition runtime claim-basis consumes `coalitionReadiness`, and delegated-action runtime claim-basis consumes `delegatedCivicActionState` plus its shared authoring, terrain, and executor boundaries; the `NETWORKS` and `DELEGATION` flags stay audit marks rather than visible state shortcuts. The launch-vector strip derives only from unresolved `launchPressureRows` plus the visible contract ledger, naming the first blocker, highest fan-out blocker, and held contract pressure before the operator enters dense route matrices. The launch-pressure register itself now exposes a `Datum`-backed blocker count, bounded/held mix, and highest downstream fan-out from `launchPressureRows`, `launchPressureStateCounts`, and `highestFanoutLaunchPressureRow`, then compact handoff / ground, effect, next lift, task status/completion, fan-out, task IDs, and source, while full current-ground and blocked-verb prose stays in title/ARIA and audit summaries. The verified-loop header renders a `Datum`-backed phase count plus armed/bounded/held mix from `loopPhaseStateCounts`, then the section starts with a pressure readout for armed span, first held phase, and aggregate proof, derived only from `loopPhases`, before the six phase cards. Its AUTHOR phase is named **Author artifact** and consumes the `message-composition` row from `buildStudioAuthoringReadiness` for state, ground, gate, and cited metric rather than hardcoding a live message-generation claim. The top operating readout, Studio workspace-posture card, authoring posture row, and authoring shift reuse the same `authoringLoopState`, `authoringLoopSummary`, `authoringLoopGate`, `authoringLoopMetric`, and `authoringLoopNextLift`, so no first-scan authoring surface can claim armed streams or count armed loop phases as Studio ground while the artifact row is bounded or not armed. The SEND phase, send readout, send posture row, and send shift reuse the same `sendLoopState`, `sendLoopSummary`, `sendLoopGate`, `sendLoopMetric`, `sendLoopGround`, and `sendLoopNextLift` from `buildSendReadiness`, so held, role-gated, or unconfigured delivery modes cannot be flattened into a generic partial-delivery claim. The compact canvas RESOLVE phase and Power workspace rail reuse the same `powerLoopState`, `powerLoopMetric`, `powerLoopGate`, and `powerLoopNextLift` contract from `buildPowerTerrainReadiness`, so loaded route terrain cannot flatten wider Power gates into a live-workspace claim. The compact canvas AGGREGATE phase and Results workspace rail reuse the same `resultsLoopState`, `resultsLoopMetric`, `resultsLoopGate`, and `resultsLoopNextLift` contract from `buildResultsProofReadiness`, so packet, receipt, and action-record ground cannot flatten proof anchoring or reader-office gates into a live-workspace claim. The capability-footprint lattice header renders a `Datum`-backed capability count plus phase-touch, held-row, and downstream-gate mix from `capabilityLattice`, `latticeStateCounts`, `touchedLatticePhaseCount`, `heldLatticeRowCount`, and `highestFanoutLatticeRow`, then row cells expose phase absence and row gates without an explainer note. People segmentation, List health, Text delivery, and Call routing headers render `Datum`-backed contract count plus armed/bounded/held mix from their shared readiness state counts before the readiness matrices, so filter posture, consent-bound reach, phone custody, and call-initiation boundaries scan as state rather than explainer notes. The coverage section now starts with a portfolio-balance readout for strongest ground, most constrained cluster, and next cluster move, derived only from the same counted cluster rows; its header renders compact cluster / state mix / lead evidence / next lift axis labels instead of explainer prose. The operator queue now starts with a pressure readout for usable moves, held verbs, and first held handoff, derived only from `safeQueue`, `gatedQueue`, and held send modes before the two queue lanes render; the two queue lane headers render count-backed usable and held totals with armed/bounded and draft/gated splits, and its header uses compact use / hold / handoff / gate axis labels instead of explaining lane placement. The claim-basis layer now starts with compact evidence / audit / boundary / gate axis labels and a pressure readout for evidence basis, first unresolved data-honesty mark, and first execution boundary, derived only from loaded slices, data-honesty marks, and execution claim rows backed by runtime flags before the ledger audit renders. The critical-path layer now starts with compact load-bearing / elapsed / dependency / gate axis labels and a pressure readout for load-bearing lift, held path pressure, and grounded substrate, then renders `elapsed` and `dependency` cells from `criticalPathRows` before the row audit, so mainnet ops, Nitro enclave setup, proof attachment, delegation, and office-integration wait states cannot collapse into generic task status. Platform intake now starts with Recognized exports, Source custody, and Direct sync boundary pressure cells from `buildPlatformIntakeReadiness` and `buildPeopleSourceProvenanceReadiness`, then renders operating stages before vendor profile rows: export recognition, credential custody, and direct sync execution each carry shared-builder state, metric, handoff, effect, and gate before the operator reads any one platform dialect. Power terrain now starts with Loaded terrain, Held terrain, and Next terrain lift pressure cells from `buildPowerTerrainReadiness` before the target/bill/score terrain matrix, so loaded ground and wider-terrain gates are visible before row parsing. Legislative monitoring now starts with Current watch, Held fan-out, and Next monitoring lift pressure cells from `buildLegislativeMonitoringReadiness` before the monitoring matrix, so org-side watch ground and alert/delegation/routing gates are visible before row parsing. Coalition composition now starts with Membership ground, Proof handoff, and Next coalition lift pressure cells from `buildCoalitionReadiness` before the coalition matrix, so network ground, detail-route proof ownership, and cross-border/artifact gates are visible before row parsing. Results proof now starts with Packet ground, Receipt evidence, and Next proof lift pressure cells from `buildResultsProofReadiness` before the proof matrix, so packet ground, bounded receipt source rows, and anchoring/reader-office gates are visible before row parsing. The coverage rows derive live/partial/draft-only/gated counts from visible cards, paths, loop phases, platform intake stages, and gate rows; they do not let one live route complete an entire cluster. Each coverage row now separates lead evidence from the next unresolved lift, so an armed surface cannot hide the boundary still preventing a stronger cluster claim. Capability cards, loop phases, compound paths, operational shifts, queue rows, gate rows, and send modes store canonical `C-*` cluster ids and derive operator-facing labels through `formatCapabilityClusters`, so cluster coverage cannot drift into parallel human-name taxonomies.

The Claimable ground row in `claimBoundaries` now reads from the weaker of `authoringLoopState` and `resultsProofReadiness.state`; its copy/evidence/gate cite `authoringLoopSummary`, `authoringLoopMetric`, `authoringLoopGate`, `resultsProofReadiness.effect`, `resultsProofReadiness.metric`, `resultsProofReadiness.detail`, and `resultsProofReadiness.gate`. Packet presence can no longer mark the claim row live by itself, and the row must not say Commons can author now while the authored-artifact contract is bounded or not armed.

Runtime claim-basis rows for server email, client merge, A/B continuation, SMS dispatch, workflow, and CWC congressional delivery consume their matching `buildSendReadiness.modes` entries for visible state, effect, and gate; the send-related feature flags remain audit marks only.

The optional map dock now exposes workspace route effects in the visible rail, not only in title or accessible text. Desktop workspace cells reserve stable width and height for state, cited signal, route effect, action grammar, and next unlock; mobile compression can hide lower lines, but the same dock control must keep the full contract in its title/ARIA.

The Mantle strong authoring command now consumes `buildStudioAuthoringReadiness`: it says **Start authoring** only when `runtimeReady` is true, otherwise **Authoring boundary** with the same signal, `Datum`-backed boundary count, state, and action grammar as Studio, Spotlight, and the Capability map. The idle Studio node mirrors that command label and state instead of rendering a generic **Compose intent** button before runtime readiness is known.

The Capability map and folded Studio use the same dependency-first authoring runtime fallback. Provider, source-discovery, or page-read gaps must read as an authoring boundary with concrete unlocks, not as a generic "not armed" dead end.

The primary Studio workspace mark now consumes `buildStudioAuthoringReadiness` through `studioWorkspaceState` and `studioWorkspaceSignal`; its visible gloss is **Authoring center**, and send-mode readiness plus publish authority no longer determine whether Studio itself appears armed. Send and route authority remain subordinate inside the verified loop, Send readiness matrix, and route handoffs. Non-publisher Studio process nodes read **publish handoffs gated**, not "view only", so the role boundary names the actual route/publish authority gate without suppressing authoring evidence.

The source-portability contract strip now separates recognized CSV source-custody readiness from direct-sync readiness: CSV and direct-sync counts each expose armed/bounded/held totals from `platformProfileCsvStateCounts`, `platformProfileApiStateCounts`, `heldPlatformProfileCsvCount`, and `heldPlatformProfileApiCount` before the vendor matrix, keeping portability and gated adapter execution visible as separate platform-neutral capabilities.

The Capability map first-scan header now renders visible contract count, surfaced/canonical cluster coverage, and armed/bounded/held contract mix through `visibleContractCount`, `surfacedClusterCount`, `clusterCoverage.length`, `visibleContractCounts`, and `visibleHeldContractCount`; it must not fall back to a prose subtitle about clusters or draft-only verbs.

The shared `WorkspaceCapabilityStrip` header now renders local contract count plus armed/bounded/held mix through `itemCount`, `stateCounts`, and `heldContractCount` before the `Ratio`, state-contract rail, and next-unlock row; it no longer uses a prose note to explain phase / cluster / handoff / gate.

The mounted People header renders `peopleHeaderMetrics` as a `Datum`-backed verification evidence strip: people loaded, address evidence, district signal, identity-verified people, and subscribed reach all cite the same layout People slice from `supporters.getSummaryStats`. The persistent People mark consumes `emailListHealthReadiness.state` plus a `peopleWorkspaceSignal` adapter, and includes `peopleSourceProvenanceReadiness.gate` in its boundary, so a subscribed count cannot mark People armed while consent, suppression, sender-domain, or source-custody gates remain bounded. A dormant People read keeps those claims uncounted instead of presenting a zeroed contact base.

The full-map People workspace-posture card now consumes `emailListHealthReadiness` and `peopleSourceProvenanceReadiness` directly: state fails closed when source custody is gated, the visible signal cites `emailListHealthReadiness.metric`, the gate concatenates source-custody and list-health boundaries, and Ground/Next render the two shared readiness signals. It must not promote `emailHealth.subscribed > 0` into a live People workspace claim.

The first-scan People ground contract now centralizes that same rule through `peopleGroundState`, `peopleGroundHref`, `peopleGroundAction`, `peopleGroundSignal`, `peopleGroundSummary`, `peopleGroundGate`, `peopleGroundMetric`, and `peopleGroundNextLift`. The proof-bound constituency card, verified-loop GROUND phase, full-map People workspace posture, operator-queue **Weight reach by proof** move, operating posture row, **Proof-bound people** compound path, and `SHIFT-PEOPLE` all consume this contract. They must not hardcode `partial`, use `people?.identityVerified` as the first-scan, queue, or compound People posture metric, or branch on local People-slice copy instead of `buildPeopleSourceProvenanceReadiness` plus `buildEmailListHealthReadiness`.

The Mantle Substrate rail now consumes `operatingGroundFromReadiness` for authority rows, donation posture, coordination logic, text delivery, call routing, and coalition posture. The adapter reads shared readiness state, signal or metric, row-count/boundary-count gate signal, action grammar, and boundary text instead of letting each substrate row maintain local label/value/state shortcuts. Registry posture may still override to `testnet`, but draft-only substrate rows compress only to bounded in the Mantle while the deeper route keeps the exact state.

The mounted Power header renders `powerHeaderMetrics` as a `Datum`-backed terrain evidence strip: followed targets, watched bills, score snapshots, and loaded terrain records cite the same layout Power slice and shared `buildPowerTerrainReadiness` terrain total. The persistent Power mark also consumes `powerTerrainReadiness.state` plus a `powerWorkspaceSignal` adapter, so followed-target, watched-bill, and score-snapshot counts cannot mark the whole workspace armed while wider terrain, office-response, or joined-plane gates remain bounded. Power secondary marks for Power targets, Bills terrain, and Accountability scores now read href, metric signal, action, and boundary from the corresponding `buildPowerTerrainReadiness.rows` entry through `capabilityMetricSignal`; local layout bill and score counts no longer supply separate Mantle signals. Bill and score metrics stay blank when legislation is not armed, while a dormant Power read keeps target, bill, and score coverage claims uncounted instead of presenting a route-load failure. The compact canvas Power rail cites the same builder through `powerLoopMetric` and keeps the first held terrain row visible as the next lift.

The full-map Power workspace-posture card now consumes `powerTerrainReadiness` directly: state reads `powerTerrainReadiness.state`, the visible signal cites `buildPowerTerrainReadiness`, route/action/gate/Next prefer `firstHeldPowerTerrainRow` when wider terrain is held, and Ground renders `powerTerrainReadiness.signal`. It must not promote `power.legislationEnabled && terrainCount > 0` into a live Power workspace claim.

The Power operational-shift row now consumes the same `powerTerrainReadiness` contract: state reads `powerTerrainReadiness.state`, route/action/gate prefer `firstHeldPowerTerrainRow`, evidence reads `powerTerrainReadiness.effect`, and the metric cites `buildPowerTerrainReadiness`. It must not hardcode `partial`, a followed-target count, or `reachExpansionGate` as the shift posture.

The first-scan Jurisdictional reach card, verified-loop RESOLVE phase, action-to-proof **Target terrain** compound step, and delegated-action **Scope terrain** compound step now consume that same `powerTerrainReadiness` / `firstHeldPowerTerrainRow` contract. The card's state, statement, evidence, effect, route, action, handoff, honesty boundary, next gate, and metric come from the shared terrain contract; RESOLVE and compound terrain steps use `powerTerrainReadiness.state`, held-row ground/gate fallback, and shared terrain evidence. They must not use local followed-target counts, `tracked targets`, `legislation.listOrgDmFollows`, hardcoded `partial`, or `reachExpansionGate` as the first-scan or compound Power posture.

The full-map Results workspace-posture card now consumes `resultsProofReadiness` directly: state reads `resultsProofReadiness.state`, the visible signal cites `resultsProofReadiness.metric`, route/action/gate/Next prefer `firstHeldResultsProofRow` when packet, receipt, anchoring, or reader-office response ground is held, and Ground renders `resultsProofReadiness.signal`. It must not replace the shared proof contract with local copy about current packets, loaded action ground, or generic receipt/reader-office lift.

The Capability coverage contract strip now renders canonical cluster count, surfaced clusters, armed clusters, bounded clusters, and held clusters from `clusterCoverage.length`, `surfacedClusterCount`, `liveClusterCount`, `boundedClusterCount`, and `heldClusterCount`; it no longer collapses cluster posture into a single all-armed prose claim.

Terrain readiness contract strips now render `terrain-contract-count` with total contracts plus armed/bounded/draft/not-armed counts from their section state-count derivations. Grounded authoring, People segmentation, List health, Text delivery, Text carrier proof, Call routing, Power terrain, Legislative monitoring, Coalition composition, Results proof, Accountability response, Funding receipt proof, Funding action, Coordination logic, and Operating authority no longer use visible prose detail sentences in the contract strip; the row grid, pressure cells, title/ARIA, and gate summaries carry the longer detail.

The Next moves header now mirrors `operatingSpine` as compact `Datum` counts for Move now, Qualify, Hold, and Next lift before the action tiles, while each tile derives its visible kicker from `stateLabel(row.state)`. The first action readout stays tied to safe queue, claim-basis, held-contract, and load-bearing-gate state rather than slogan copy.

The Launch vector header now renders compact `Datum` metrics from `launchVectorReadouts` for First unblock, Largest fan-out, and Held surface before the row audit, so launch-priority scan stays tied to unresolved pressure rows and the visible-contract ledger instead of explanatory copy.

Accountability response now starts with Response ground, Reader signals, and Next response lift pressure cells from `buildAccountabilityResponseReadiness` before the response matrix, so proof-delivery rows, aggregate reader signals, and office/anchoring/scorecard gates are visible before row parsing.

Funding action readiness now starts with Funding ground, Confirmation register, and Next receipt lift pressure cells from `buildFundraisingReadiness` before the funding matrix, and the map renders `buildFundraisingReadiness.proofRows` before the broader matrix. The fundraising index/create/detail `WorkspaceCapabilityStrip` instances now map from `buildFundraisingReadiness.rows`, while the same proof contract appears on index/detail routes at `#fundraising-receipt-proof-contract`. Index/detail now open that contract with route-local **Funding receipt proof pressure** cells for Funding ground, Confirmation register, and Next receipt lift, derived from `buildFundraisingReadiness.proofRows` before the detailed receipt matrix. The creation route also opens with route-local **Funding receipt proof pressure** cells for Funding ground, Confirmation register, and Next receipt lift, remapped to `#fundraiser-definition`, `#fundraiser-publication`, `#fundraiser-checkout-boundary`, and `#fundraiser-receipt-boundary` before the form; it does not render the full receipt matrix until a saved route exists. Fundraiser record ground, public intake scope, payment-provider handoff, webhook completion, confirmation outcomes, provider send acceptance, receipt-policy custody, and tax/anchoring boundaries are visible before saved fundraiser/public-intake ground, baseline confirmation evidence, or tax/anchored receipt gates can be overclaimed. Creation passes local draft-record state, publish intent, email-proxy confirmation boundary, and local anchors into the same shared builder before the form.

Coordination readiness now starts with Definition ground, Side-effect runner, and Next run lift pressure cells from `buildCoordinationReadiness` before the coordination matrix, so saved workflow logic, side-effect posture, and run-evidence gates are visible before row parsing. Workflow email dependency now uses the same route-local runtime readout on workflow index, builder, and detail surfaces: the server loads call `getWorkflowEmailRuntimeReadinessFromEnv` with `organizations.getOrgKeyVerifier`, and `WorkflowEmailDependencyPanel` renders email-step count, arm-time missing dependencies, and per-run checks before workflow controls, definition cards, or run logs can imply dependency-free email automation.

Email send posture now starts with route-local **Email send pressure** cells for Delivery ground, Browser path, and Next send lift before the email index's A/B boundary and delivery records. Those cells derive saved-record ground from `email.listBlasts`, browser delivery from the shared `browser-direct` send-readiness mode, and the next lift from `sendReadiness.nextHeldMode`, so delivery records, browser-side send, server dispatch, A/B continuation, and wider send-mode gates remain explicit instead of collapsing into email-dashboard copy.

The coalition index now opens with route-local **Coalition composition pressure** cells for Membership ground, Proof handoff, and Next coalition lift before routing/artifact/creation boundaries or membership cards. The cells derive from `buildCoalitionReadiness`: loaded network memberships, aggregate-proof detail handoff, and the first held routing/artifact boundary stay visible before an operator treats coalition records as shared proof, shared supporter access, or durable coalition artifacts.

Operating authority now starts with Authority ground, Signed substrate, and Next authority lift pressure cells from `buildOperatingAuthorityReadiness` before the authority matrix, so current role power, signed-event substrate, and audit/succession/API/custody/registry gates are visible before row parsing.

The optional canvas map mirrors the same coverage truth in compact chips: each cluster count now carries a distinct lead-evidence field and next-lift field, with title and aria text preserving the stronger-claim boundary. Its first-viewport operating readouts, claim-boundary rows, Next moves, and launch-pressure rows use stable ids for render identity and cluster lookup, so changing visible copy does not remount or reclassify compact capability rows. Next-move kickers in the full map and canvas are derived from each row's armed/bounded/draft-only/not-armed state label, so bounded or held authoring cannot appear under a standalone "use now" affordance. Its SEND loop phase, send readout, next send move, claim qualifier, and Hold spine cell reuse the same `sendLoop*` contract from `buildSendReadiness`, so the inhabited map cannot drift into a terse route label, raw held-count copy, or a generic partial-delivery claim. Launch-pressure chips use the same handoff / ground, effect, and next-lift contract as Studio while preserving full GateEvidence in title/ARIA. Full object nodes now render the same route handoff/effect contract as the Studio ledger and land on specific existing anchors where available: People ledger, consent-bound reach, Power target boundary, bill terrain boundary, scorecard list, and proof delivery. `constellationCapabilityContract` accepts only `DataConstellationObject` and has no default branch, so new data-object variants must name a concrete handoff/effect/gate instead of inheriting generic capability copy.

The compact canvas INTENT phase consumes the `intent` row from `buildStudioAuthoringReadiness`; publish authority cannot locally mark the phase live or partial outside that shared authoring contract. The compact canvas AUTHOR phase consumes the `message-composition` row from `buildStudioAuthoringReadiness`; runtime readiness and broader Studio contract state cannot promote the AUTHOR cell until the current run emits authored-artifact evidence. The canvas Studio workspace rail now consumes `buildStudioAuthoringReadiness.state`, so publish authority cannot either promote Studio authoring or downgrade it to a permission gate; non-publisher Send and workspace-posture boundary copy comes from `buildSendReadiness.sendBoundarySummary` / `nextHeldLabel`, naming org authority for delivery-surface draft handoff and the first held send handoff instead of a layout-owned permission sentence. The compact canvas GROUND phase consumes `buildPeopleSourceProvenanceReadiness` for state, action, metric, and cite, then appends `buildEmailListHealthReadiness` as the consent-bound reach gate, so identity-verified counts cannot promote People ground alone. The compact canvas People workspace rail consumes `buildEmailListHealthReadiness` for state, metric, action, and next gate, then appends `buildPeopleSourceProvenanceReadiness` as the source-custody gate, so a raw subscribed count cannot mark People live without consent-bound reach and source-custody posture.

The canvas Coverage summary now exposes covered/canonical cluster count plus armed/bounded/held cluster mix from `fieldCoveredClusterCount`, `CAPABILITY_CLUSTER_IDS.length`, `fieldCoverageStateCounts`, and `fieldHeldClusterCount`; it no longer uses a prose field-evidence note where cluster posture belongs.

The Studio capability map now preserves stable capability identity through render keys: core capability cards, workspace posture rows, launch-pressure rows, capability lattice rows, claim-basis rows, critical-path rows, gate-register rows, and safe queue moves key by explicit ids, held send rows key by send-mode keys, and none of those surfaces depend on editable human labels to keep rows mounted.

The org product is in the **dangerous middle state**: the surface looks finished, but a real user hitting the workflow encounters a 501, a no-op, or an empty result. Closing the top ~10 stubs is the difference between "Phase 0-2 marketing claim" and "actually launchable to first paying orgs."

## Capability surface by domain

### 1. Org foundation + supporter management

**Org CRUD + multi-tenancy** 🟡
Create/update via `convex/organizations.ts:522,313`. Schema at `convex/schema.ts:1362`. Slug uniqueness via `by_slug` index. Defaults: `countryCode: "US"`, `maxSeats: 2`, `isPublic: false`. **Gaps:** no org delete mutation; no slug rename (update excludes slug); no `customDomain`/`fromEmail`/`replyTo` fields at org level (only on `emailBlasts` rows); no branding theme.

**RBAC** 🟡
Three roles (owner/editor/member) hierarchy enforced in `convex/_authHelpers.ts:requireOrgRole`. Invite system at `convex/invites.ts` with HMAC-hashed tokens, 72-hour expiry, seat-limit check at invite creation (`invites.ts:488`). Cross-org membership: `getMyMemberships` returns all orgs for a user; `by_userId_orgId` index. Member removal and role changes are live through `organizations.removeMember` and `organizations.updateMemberRole`, with owner-only role mutation, self-leave, rank-ceiling, memberCount decrement, and last-owner lockout guards. `/api/org/[slug]/members` exposes DELETE/PATCH, and Org authority disables last-owner demotion/removal controls before click. `buildOperatingAuthorityReadiness` now lifts publish authority, team seats, owner-only role mutation, owner-transfer boundary, org audit-log boundary, billing limits, public API ground, signed webhooks, org-key custody, tier-feature boundaries, and registry posture into the OS map, Spotlight, Mantle, the Studio delivery-surface handoff authority gate, and Org authority strip with the same state grammar. The Org authority route now opens with **Org authority pressure** cells for Authority ground, Signed substrate, and Next authority lift, derived from those rows before billing meters, plan controls, developer ground, team authority, or encryption authority. The lower Org authority controls are now labeled as **Plan limit ground**, **Tier feature boundaries**, **Role authority**, **Legislative domain basis**, and **PII encryption authority**, so the route reads as operating-ground custody and limits rather than settings/admin chrome. The Launch pressure / Launch vector **Reader-office notifications** row routes to `/settings/webhooks#reader-notification-boundary`, cites signed event substrate as current ground, and keeps office profiles, office-response workflow, and notification consumers gated, so live signed webhooks do not imply Commons-owned reader-office alerting. **Gap:** no explicit transfer-owner ceremony and no org-level audit log.

**Supporter management** ✅
Paginated list with cursor at `convex/supporters.ts:36` (max 100/page, scans up to 10K). Filters: emailStatus, verified, source, tagId. Source filtering now uses the same normalized source basis as `supporters.getSummaryStats.sourceCounts`: missing metadata is filterable as `unknown`, API-created rows are labeled `api`, and custom source strings already present in aggregate counts are added to the ledger filter rather than hidden behind a dash. Saved segment source filters use the same normalized basis and support both `equals` and `excludes`. Tags: flat, org-scoped, auto-create on import (`ensureTags`). Custom fields: single encrypted JSON blob (`encryptedCustomFields`). Fields stored: email (encrypted), name (encrypted), phone (encrypted), postalCode, stateCode, congressionalDistrict, country, emailStatus, smsStatus, optional email/SMS consent source/date/text evidence, verified, identityCommitment, source. Summary stats at `supporters.ts:260` include no-PII consent-evidence counts (`email`, `emailSubscribed`, `sms`, `smsSubscribed`). The folded People workspace now renders a `#people-ledger-handoff` before the route handoff: ledger rows, proof-weight rows, source origins, reachable rows, state-aware action grammar, and the source-custody next gate make the encrypted person table read as operational drilldown rather than contact management. The `/supporters` route presents the list as People ledger: it opens with a `Datum`-backed evidence strip for people loaded, address evidence, district signal, identity verified, and subscribed reach, then its capability strip and verification/source/segment/list-health instruments precede a `#people-ledger-boundary` that cites page rows, `supporters.getSummaryStats` total, URL filter state, and the civic-geography label gate before the encrypted person table. Its `#people-row-drilldown-controls` section then gives search, status, source, tag, and cohort controls their own bounded row-drilldown state/action contract with cited page rows, total people, active filters, tag labels, `buildPeopleSegmentationReadiness`, and the civic-geography label gate. The person detail route maps its strip from `buildPersonDetailRows`, separating verification weight, reach authorization, source custody, and custom-field custody. It then renders `#person-row-custody` with cited capability-row, encrypted-field, tag-label, and custom-field custody metrics plus the custom-field type-system gate before decrypted fields and tag controls, so a single person row reads as custody-bound drilldown rather than a contact profile. Unknown source metadata stays bounded, and encrypted custom-field blobs cite the `T10-7` custom-field type-system task for typed/schema/segment behavior. Row records are operational drilldown, not proof-weight claims by themselves. **Gaps:** imported congressional district is operator-supplied custody, not verified geocoding; no materialized local/special district membership on supporter rows; no free-text search (hash-based only); custom fields are opaque (no type system).

**CSV / platform export import** ✅
3-step wizard at `src/routes/org/[slug]/supporters/import/+page.svelte` with a first-row People import capability contract. The contract shows export recognition, person key, source custody, consent evidence custody, custom field custody, encrypted batch write, and direct platform sync state before upload; it uses the same state grammar and `formatGateEvidence` gate language as the OS capability map. Client-side RFC 4180 parse with BOM stripping. Auto-mapping includes common email/name/postal/state/congressional-district/phone/tag/consent aliases plus consent source/date/text aliases and profile detection from `src/lib/data/platform-export-profiles.ts` for Action Network, EveryAction/NGP VAN, NationBuilder, Mailchimp, Salsa Engage, Mobilize, ActBlue, Engaging Networks, CiviCRM, and Salesforce/Nonprofit Cloud exports. The shared source registry also labels `api`, `organic`, `widget`, and `unknown`, and the ledger carries custom API/source strings from aggregate counts into filter options. Each recognized profile row now carries separate shared handoffs: `csvHref` for the live CSV intake path and `apiHref` for the encrypted credential/sync-boundary path, plus the same sync-proof checklist used by the OS map, so a gated direct-sync badge never routes or reads like an armed CSV profile. Manual mapping can mark nonstandard columns as encrypted custom fields; the server preserves those values as a per-person encrypted JSON blob (`encryptedCustomFields`) while keeping them custody-only, not typed or segmentable. Consent status/source/date/text columns are stored as bounded audit metadata and aggregate into `supporters.getSummaryStats.consentEvidence`; duplicate imports can only tighten email/SMS suppression status, never soften complaints, bounces, STOP, or unsubscribed states. The server repeats source detection from the same shared profile module and `supporters.importWithEncryption` preserves the detected source (`action_network`, `everyaction`, `nationbuilder`, `mailchimp`, `salsa`, `mobilize`, `actblue`, `engaging_networks`, `civicrm`, `salesforce`, or `csv`) on imported people. The People summary aggregates source values through `supporters.getSummaryStats.sourceCounts` into `OrgSpacesData.base.sourceCounts`; `buildPeopleSourceProvenanceReadiness` feeds the People secondary handoff, Spotlight command, Capability map card, operator queue, claim-basis row, folded People workspace, and deep `/supporters` ledger from that same no-PII evidence without making any one platform the product frame. Manual column mapping UI. Org-scoped email-hash dedup. Per-row error collection. Batch tag auto-create via `ensureTags`. Max 10 MB file, 5,000 supporters per server action call, 100 rows/batch. Encrypted single-phase insert via `importWithEncryption` action. **Gaps:** no partial-resume for files >5,000 rows; custom fields remain opaque (no type system or field-level segmentation); imported consent evidence is not a double-opt-in or legal-policy workflow.

The import wizard now begins with **Source portability pressure**: recognized exports from `buildPlatformIntakeReadiness`, current aggregate source custody from `buildPeopleSourceProvenanceReadiness`, and the direct-sync boundary from `getPlatformApiSyncReadiness`, each with `Datum`, state-aware action grammar, source evidence, and gate text before the CSV drop zone. This keeps profile names as dialect evidence while the operator-facing capability remains source-custody intake across formats.

**Direct platform sync** 🟡 (Action Network adapter armed via the bounded runner; the other nine profiles and tag/list sync stay held)
Schema for adapter sync state exists (`organizations.anSync` embedded object: encrypted credential payload, adapterSource, credentialStoredAt, credentialVersion, credentialProbeCompletedAt, credentialProbeVersion, status, syncType, totalResources, processedResources, currentResource, checkpoint, imported, updated, skipped, errors). UI at `src/routes/org/[slug]/supporters/import/platform-api/+page.svelte` presents a vendor-neutral platform portability boundary, labels stored adapter state as custody metadata, cites it with `Datum`, and shows the source-portability state mix with `Ratio`; the legacy `action-network` URL redirects to that boundary. The stored-state section now normalizes the same runtime/custody ground passed into `buildPlatformIntakeReadiness` and leads with stored-envelope, custody-probe, runner, and held-check evidence. Direct import counters (`imported`, `updated`, `skipped`, progress) render only when direct import execution evidence exists, so a stored credential cannot read as a zero-row sync. The source-portability rows reuse `csvHref`/`apiHref` from `buildPlatformIntakeReadiness`, so the sync boundary can show CSV export intake as the live migration route while credential custody and direct sync proof stay on the boundary route. The route and Capability map now render the shared `buildPlatformIntakeReadiness.proofRows` contract: profile registry, credential custody, credential probe, adapter execution, import safety, and continuation checkpointing. Each direct sync row also carries the same proof checklist: resource pagination, consent and suppression mapping, idempotent source-key upsert, rate-limit backoff, and chunked continuation checkpoint. The route action grammar separates missing encryption custody from missing adapter execution: credential rows read `read custody boundary`, `verify stored credential`, or `read credential proof`, while direct-sync rows read `read sync boundary`. The Launch pressure / Launch vector **Direct platform sync** row also routes to `#platform-sync-boundary`; CSV upload remains the separate live **Platform export intake** handoff. `getPlatformApiSyncReadiness` is the direct sync boundary for this capability: direct platform sync is not ready unless the profile registry, encrypted credential custody, direct sync execution, and continuation checkpointing are all present. The `connect` server action stores an encrypted credential for a selected platform profile when `PLATFORM_API_CREDENTIAL_ENCRYPTION_KEY` (or the OAuth encryption fallback key) is configured; it does not call the platform or import people, and missing custody returns a structured HTTP 424 `platform_api_credential_custody_not_configured` boundary. The `sync` server action now performs a bounded credential-custody probe: it decrypts the stored credential envelope for the selected platform profile, verifies the envelope/profile binding, persists `credentialProbeCompletedAt`/`credentialProbeVersion` through `organizations.recordPlatformApiCredentialProbe`, returns `platform_api_credential_probe_complete`, and stops before any network call or import. Probe success shows custody/probe evidence and a formatted direct-sync gate summary instead of raw `blockedVerb`/gate ids. **Direct platform import is armed per adapter through the bounded runner at `src/lib/server/platform-sync/`** (`PLATFORM_API_SYNC_RUNNER_IMPLEMENTED = true`; `getPlatformApiSyncReadiness.armedAdapterSources` derives from the `PLATFORM_SYNC_ADAPTERS` registry). The Action Network adapter makes real OSDI HTTP calls — paginated `people` fetch with `OSDI-API-Token` auth, optional `modified_date` incremental filters from `lastSyncAt`, typed auth/rate-limit/malformed error taxonomy — and maps subscription status onto the import pipeline's email/SMS vocabulary without fabricating consent provenance. The `import` server action runs one bounded slice per invocation (at most `MAX_PAGES_PER_SLICE` vendor pages, ~300ms between fetches), hands normalized records to `supporters.importWithEncryption` in 100-row chunks, persists the continuation cursor in `anSync.checkpoint` through `organizations.recordPlatformApiSyncProgress`/`completePlatformApiSync`/`failPlatformApiSync` (all editor-gated), and resumes a parked or transiently failed run from its checkpoint. Platforms without a registered adapter still return the structured HTTP 424 boundary, the dead legacy `*AnSync` wrapper mutations are deleted, and tag/list sync stays gated by T1-3: each remaining direct sync execution still needs its own proven format contract. Run-state integrity is guarded: stale running rows older than ten minutes are reclaimable, a losing concurrent racer cannot flip a terminal run to failed, custody probes cannot clobber a parked run's checkpoint lifecycle, and capped per-row import errors persist into `anSync.errors`.

**Other platform imports** 🟡
EveryAction/NGP VAN, NationBuilder, Mailchimp, Salsa Engage, Mobilize, ActBlue, Engaging Networks, CiviCRM, and Salesforce/Nonprofit Cloud exports can enter through the live CSV path with source recognition. Direct API syncs for those systems are not implemented. Marketing copy should describe platform export intake, not imply live API connectors.

**Segmentation UI** 🟡
Filter builder in `src/lib/types/segment.ts` + shared matcher in `convex/_segmentMatch.ts`. 13 field types: `tag` (includes/excludes), `verification` (equals), `engagementTier` (equals/gte/lte from max action tier), `source`, `emailStatus`, `dateRange`, `campaignParticipation` (participated/notParticipated via indexed action context), `actionDistrict` (exact action `districtHash`), `actionDistrictLabel` (equals action-time readable congressional district label), `postalCode` (equals/startsWith), `stateCode` (equals from imported state/province code), `congressionalDistrict` (equals from imported readable label), and `country` (equals). AND/OR at filter level. Saved segments per org. Bulk apply/remove tag, paginated to ~51K supporters. Encrypted + decrypted CSV export. Email `recipientFilter` now accepts saved `segmentIds`; the composer loads saved People segments, counts through `email.countRecipientsForFilter`, and dispatch-time recipient loading enforces the same segment contract. The org OS and `/supporters` ledger now lift this into `buildPeopleSegmentationReadiness` using only aggregate saved-segment condition counts from `OrgSpacesData.base.segmentation` or the route-local `segments.list` read, so saved cohort posture, source custody filters, proof/reach filters, imported state-code and congressional-district filters, action-time district-label filters, action-context filters, and the remaining civic-geography label gap are visible without loading matched people into the shell. The route-local `SegmentBuilder` also carries that civic-geography boundary beside its active filter grammar: imported/action-time label and action-district hash counts cite the current filter, local/special district labels stay gated through `T1-8c`, and any count or bulk tag result returned with `partial: true` renders as a lower bound instead of an exact cohort total. Launch pressure routes **Civic geography cohorts** to `/supporters#people-segments`, where the segmentation posture and geography-label gate are visible, instead of dropping the operator into the generic People ledger. **Gap:** imported and action-time congressional district labels are not verified/materialized local/special geography; no local/special district membership filter exists yet; action-district hashes remain action-context filters, not readable district cohorts.

**Client-direct merge personalization** 🟡
The merge flag is not a live-send claim by itself. The org OS capability map and Spotlight derive merge personalization from browser-direct email readiness: subscribed cohort count, client-direct threshold, org-key verifier, SES proxy configuration, dispatch claim, Lambda proxy, SES receipts, and composer-level merge-token checks. When those dependencies are missing or the cohort exceeds the browser-direct cap, merge remains draft-only or dependency-first.

Spotlight command rows carry the same route contract as the capability map and operator queue: handoff object, route effect, signal, gate, state-aware action grammar, and latent/not-armed downgrade. Search and accessible copy index handoff/effect as first-class fields so command execution reads as an operational contract rather than a route list.

**Subscription state** ✅
`emailStatus`: subscribed/unsubscribed/bounced/complained. HMAC-signed unsubscribe tokens with dual-secret rotation (`UNSUBSCRIBE_SECRET`). SES bounce/complaint webhooks update cross-org via globalEmailHash. Complaints always win and cannot be softened. SMS STOP keyword → `smsStatus: stopped`, manual override blocked. START re-engagement wired via Twilio webhook. Imported email/SMS consent source/date/text evidence is stored on supporter rows and counted only as aggregate custody ground in the OS. Stranded placeholder cleanup cron (15-min threshold). Convex server-side SES sends now build per-recipient `List-Unsubscribe` + `List-Unsubscribe-Post` headers through SES v2 `Simple.Headers` when dispatch is armed and `UNSUBSCRIBE_SECRET` is configured. The Launch pressure / Launch vector **Consent-bound reach completion** row routes to `/supporters#email-health`, cites subscribed reach plus consent-evidence custody as current ground, and keeps mailbox one-click rendering plus per-org sender-domain authentication as the next lift. **Gaps:** no double opt-in flow; no statutory consent-policy workflow; T2-4b provider rendering still needs production dispatch verification.

**List hygiene** 🟡
Cross-org bounce propagation. `suppressedEmails` table with domain-level + per-email suppression. `bounceReports` table. Permanent SES bounces and complaints update matching supporters by `globalEmailHash`; transient/undetermined SES bounces use a 3-strike TTL suppression path; manual bounce reports suppress after two independent verified reporters and resolve their contributing report rows. Reacher SMTP probing remains unwired. Complaint-wins logic. **Gaps:** no re-engagement triggers; no sunset policies beyond bounce TTL suppression; no cross-org dedup for imports (only for bounces/complaints).

**Custom domain + DKIM/DMARC** 🔴
No code. Schema has no `customDomain`/`dkimKey`/`dkimSelector`. From-email hardcoded `${org.slug}@commons.email`. Marked gated in the settings plan comparison rather than presented as an armed Organization+ capability.

**Audit log** 🔴
No org-layer audit log. `verificationAudits` is user-identity scoped. `agentTraces` is per-request. No table records who-did-what-when at the org level.

### 2. Campaign engine + verification packet

**Campaign CRUD** ✅
Create at `convex/campaigns.ts:322`. Update at line 407 covers title, type, body, status, templateId, debateEnabled/Threshold, targetCountry, targetJurisdiction, position. Status FSM at line 599: `DRAFT → ACTIVE`, `ACTIVE → PAUSED | COMPLETE`, `PAUSED → ACTIVE | COMPLETE`. Delete at line 474 cascades to `campaignActions` and `campaignDeliveries`. Clone/duplicate ships via `campaigns.clone` and the campaign list duplicate action. Target management at lines 642/698 (max 50 targets/campaign, email dedup). `getStatusCounts` at line 287. Campaign types in schema: `LETTER`, `EVENT`, `FORM`, `FUNDRAISER`. **Gaps:** no `PETITION` type; no scheduled activation (`scheduledAt` doesn't exist on campaigns); no audience segment targeting on campaign; no per-campaign sender identity (from-email is env var only — `dispatchReportEmails` at line 1607 hardcodes it).

**Campaign actions** ✅
Schema at `convex/schema.ts:1702`: `campaignId`, `orgId` (denorm for billing), `supporterId`, `verified`, `engagementTier`, `districtHash`, `h3Cell`, `messageHash`, `trustTier`, `compositionMode`, `delegated`, `delegationGrantId`, `sentAt`. Action creation at `campaigns.ts:896` with `by_campaignId_supporterId` dedup. Submission flow at line 992 (PII encryption, dedup, district hash, K-floor on returned count). **Note:** for new actions, `trustTier` is correctly snapshotted at submission time (frozen on the row). The legacy gap is pre-H1 rows with `undefined` trustTier — these are filtered cleanly from identityBreakdown by `a.trustTier !== null`.

`buildActionRecordReadiness` now owns action-record index, builder, and detail route strips. Saved action records, jurisdiction resolve, reader action intake, packet artifacts, decision-maker proof delivery, quality settlement, completed evidence, and CWC proof-delivery boundaries share one gate-backed contract instead of route-local action/CWC copy. The action creation route now opens with **Action creation pressure** cells for Draft ground, Proof route, and Next proof lift before the form, deriving draft-record ground, jurisdiction resolve, and held proof/CWC/settlement lift from that same builder. Unsaved actions are presented as authoring ground only; proof delivery, quality settlement, reader participation, and receipt anchoring stay visually bounded until their row evidence is present.

**Verification packet system** ✅
`computeVerificationPacketCached` at `src/lib/server/verification-packet.ts:65`. KV-cached (30s TTL), falls back to fresh compute. Raw data via `campaigns.getActionsForPacket` (auth-gated). **Call sites include:** campaign detail page load, report preview load, report send action, email-html endpoint, SSE stream, and the org OS layout Results slice. Computed fields (lines 102-161): `verified`, `total`, `verifiedPct`, `districtCount`, `authorship` (individual/shared/unknown/explicit), `dateRange`, `identityBreakdown` (govId/addressVerified/emailOnly/unverified), `gds`, `ald`, `temporalEntropy`, `burstVelocity`, `cai`, `tiers`, `geography` (DistrictWeight[]), `cells` (CellWeight[], H3 res-7, K>=5 floor), `temporal` (hourly bins), `lastUpdated`. The folded Results workspace, persistent Results mark, and proof-delivery report route all consume `buildResultsProofReadiness`, so packet, verifier, bounded receipt evidence, receipt anchoring, coordination-integrity, and office-response boundaries stay aligned with the OS map. The report route now renders **Report Results proof pressure** before local delivery controls, deriving Packet ground, Receipt evidence, and Next proof lift from those shared rows before the detailed matrix and sender-delivery contract. The mounted Results header now renders `resultsHeaderMetrics` as a `Datum`-backed proof evidence strip: current packet verified actions, bounded receipt rows, logged responses, and active action records all cite the same layout Results slice. The mounted Results sidebar renders **Receipt response posture** from the same bounded receipt summary rather than a recent-supporter signup feed. The org layout also reads `legislation.getOrgReceiptSummary` into `OrgSpacesData.return.receipts` as a bounded recent-row sample (`loadedCount`, pending rows, logged-response rows, anchor-field rows, proof-weight total, latest proof timestamp, sample limit); this is source-row evidence, not a total receipt ledger or permanence claim. The Launch pressure / Launch vector **Durable proof settlement** row routes to `/studio#capability-critical-path`, cites verification packet plus Sepolia/testnet registry posture as current ground, and keeps receipt roots, durable archive proof, public-chain permanence, and mainnet DistrictRegistry/DebateMarket/SnapshotAnchor gated, so Results packet visibility does not imply long-term survivable proof. The report route returns the computed packet used by `renderReport` before local queue controls. **Closed since audit:** the org root is now an addressability shim, and `src/routes/org/[slug]/+layout.server.ts` computes a top active/recent campaign packet for the mounted Results space when campaign data exists. New orgs still render an honest empty packet state rather than a fabricated count.

**Coordination integrity** ✅
All 4 metrics implemented in `verification-packet.ts`:

- **GDS** (`computeGDSFromDistribution`, line 305): 1 − HHI over district action distribution
- **ALD** (`computeALD`, line 320): unique `messageHash` count / total with hashes
- **Temporal entropy** (`computeEntropyFromBins`, line 359): Shannon entropy over hourly bins
- **Burst velocity** (`computeVelocityFromBins`, line 370): peak hourly count / mean of non-zero bins
- **CAI** (`computeCAI`, line 391): (tier3 + tier4) / max(tier1, 1)

Displayed by `CoordinationIntegrity.svelte` with normalized bars, amber warning for burst velocity > 5, explicit identical-content threshold warning, and an absent-geography warning when actions exist but `districtCount` is 0.

**Tier distribution rendering** ✅
`computeTierDistribution` at line 403 produces `TierCount[]` with K-anonymity floor (count < 5 → -1). SSOT helper at `src/lib/core/identity/tier-display.ts`. `VerificationPacket.svelte` now renders engagement depth (0-4: New/Active/Established/Veteran/Pillar) from `packet.tiers` and displays sub-K bins as `<5`, not as negative counts. CoordinationIntegrity still shows CAI ratio separately.

**Campaign report rendering** ✅
`src/lib/server/email/report-template.ts:renderReport` produces `{html, text, attestationHash, subject}`. Fully inlined CSS, email-client-safe table layout. Verified count hero, identity composition bar, authorship bar, geography bar (top 8 districts), date range, attestation hash + verification URL. `canonicalPreimage` + SHA-256 → `attestationHash` referenced to `REPORT-ATTESTATION-SPEC v1`. Text fallback at `renderText`. Mobile responsive (`max-width: 560px`). Print/PDF at `src/routes/org/[slug]/campaigns/[id]/report/email-html/+server.ts` with `X-Attestation-Hash` header.

**Specimen / packet display surfaces** 🟡

- Campaign detail (`/org/[slug]/campaigns/[id]`): ✅ VerificationPacket hero with live SSE updates, CoordinationIntegrity below, proof-delivery handoff
- Report page: ✅ Renders `renderedHtml` as iframe preview, sender delivery register with status tracking, explicit `receiptEligibility`/`receiptBlockers` readiness, explicit `receiptBacked` marker when an accountability receipt row exists, verifier links for receipt-backed rows, and manual response annotations separated from reader-office workflow
- Email HTML endpoint (`/report/email-html`): ✅ Standalone printable
- SSE stream (`/api/org/[slug]/campaigns/[campaignId]/stream`): ✅ pushes updates every 30s
- **Org home page (`/org/[slug]`): ✅ mounted Results space computes a top-campaign packet when action-record data exists, loads a bounded accountability receipt source-row summary, and otherwise renders honest empty packet/receipt states**
- Public verification page (`/v/[hash]`): partial — returns only `dateRange` for anonymity

**Anti-astroturf signal surfacing** 🟡
Burst velocity > 5 → amber warning in `CoordinationIntegrity.svelte`. ALD < 0.50 → explicit identical-content threshold flag in the admin coordination panel. `total > 0 && districtCount === 0` → absent-geography warning in the admin coordination panel, phrased as uncounted geographic diversity rather than a generic cannot-claim feature error. GDS < 0.7 + ALD < 0.7 → qualitative reader prose in `IntegrityAssessment.svelte`. The org OS capability map treats this as live only when a current verification packet is loaded; otherwise it shows a partial/gated current-org state with no invented metric and routes back to action records. **Gap:** no coordination-score-over-time chart.

**Trust-tier snapshot at action issuance** 🟡
New actions correctly snapshot `trustTier` at insert (`campaigns.ts:1168`). Pre-H1 legacy rows have `undefined` trustTier; cleanly excluded from identityBreakdown by null filter. The remaining gap is documentation only — the original tech-debt note refers to a pre-H1 condition that no longer applies to new actions.

**Atlas version tracking on campaigns** 🟠
`campaignActions` accepts `h3Cell` and `atlasVersion`, and the public `/c/[slug]` verified-address flow now carries both values from `POST /api/c/[slug]/verify-district` into the final submission after district verification succeeds. The embed widget now has an optional district-evidence drawer that calls the same resolver and submits `districtCode`, `h3Cell`, and `atlasVersion` only after successful resolution. Campaign-level packet drift detection is row-evidence, not a universal action claim: postal-only or skipped district-evidence submissions still carry no atlas signal. H6's `atlasDrift` signal is for individual credentials on `/v/[hash]`; packet-level drift should stay qualified to action rows with atlas evidence.

**Campaign-level analytics** 🟡

- Verified-count over time (`CampaignAnalytics.timeline`): ✅ daily buckets, gated by `FEATURES.ANALYTICS_EXPANDED=true`
- Geographic spread (`topDistricts`): ✅ top 10 districts via `GeographicSpread.svelte`
- Delivery metrics (`getDeliveryMetrics`): ✅ sent/delivered/opened/bounced plus observed verify-link clicks from `campaignDeliveries.responses` / `accountabilityReceipts.responses`
- Campaign-level complaint count: not exposed. SES complaint webhooks update People/list-health suppression status, but there is no delivery-correlated complaint event in `accountabilityResponseType` yet; the analytics contract must not return a hardcoded campaign complaint zero.
- Coordination scores over time: 🔴 no time-series
- Verification funnel (postalResolved/identityVerified/districtVerified): ✅ org layout reads `organizations.getDashboardStats`; People reads `supporters.getSummaryStats`, including aggregate `sourceCounts` for source-origin custody
- Click tracking: 🟡 SES webhook handler exists; verify-link clicks are observed when SES click events arrive, while generic click attribution remains configuration-bound and should not be presented as a complete click-through claim

**Delivery tracking** ✅
Schema at `convex/schema.ts:1733`. `dispatchReportEmails` at `campaigns.ts:1599` uses SES v2 raw HTTP. `sesMessageId` stored for correlation. `updateDeliveryStatus` handles collision with steal policy and now creates a pending `accountabilityReceipts` row only after SES accepts a receipt-eligible proof delivery with `decisionMakerId`, `billId`, `packetDigest`, `proofWeight`, and packet summary present. Report delivery rows bind `decisionMakerId` and `billId` when available and store `receiptEligibility`/`receiptBlockers` so missing target/bill rows remain honest sender rows. Response tracking via `recordResponse` (replied/meeting_requested/vote_cast/public_statement). Past deliveries view at `campaigns.ts:1974`. **Channel coverage:** email via SES works; CWC code complete (`convex/_cwcXml.ts`, 295 LOC) but gated by `FEATURES.CONGRESSIONAL=false`; postal not implemented.

**Per-campaign settings** 🟡
Present: `targetCountry`, `targetJurisdiction`, `debateEnabled/debateThreshold`, `targets[]` (max 50), `billId`+`position`, `districtCode`+`districtCentroid`, `templateId`. Missing: `scheduledAt`, per-campaign sender identity, audience segment filter, embed domain whitelist.

**Campaign templates** ✅
Quota enforced: 10/100/500/1000 by plan tier at `convex/templates.ts:990-999`. Full CRUD via `convex/templates.ts`. **Gap:** no template clone endpoint.

### 3. Email infrastructure

**Compose UI** 🟡
Tiptap (ProseMirror) at `src/routes/org/[slug]/emails/compose/+page.svelte` (1,338 LOC). StarterKit + Link + TextAlign + Underline extensions. Merge-field click-to-insert (`{{firstName}}`, `{{lastName}}`, `{{postalCode}}`, `{{tierContext}}`). Preview via `compileEmail()` → iframe srcdoc. The composer now reads filtered source counts beside the recipient total through `email.countRecipientsForFilter`, so selected-cohort delivery posture can show preserved People source custody without loading plaintext identity or privileging one platform. **Gaps:** no type-ahead autocomplete on merge fields; no mobile viewport simulation toggle; HTML-only (no plaintext multipart) across all paths.

**Merge fields / personalization** 🟡
Supported tokens: `firstName`, `lastName`, `email`, `postalCode`, `verificationStatus`, `tierLabel`, `tierContext`. Preview still uses `compileEmail()` with sample context and is not a delivery claim. The Convex server batch path resolves supported tokens after PII decrypt when server dispatch runtime dependencies pass. The browser-direct path resolves supported tokens after org-key decrypt and switches to singleton Lambda sends when a subject/body contains merge fields. The composer now states this as a path-specific boundary: browser-direct personalization is draft-only when `EMAIL_CLIENT_DIRECT_MERGE` is not armed, while server-side personalization remains governed by the server dispatch runtime gate. **Gaps:** client-direct personalization is limited to cohorts under the browser cap and still depends on org key, dispatch claim, Lambda proxy, SES receipts, and cohort filters; `tierLabel` remains empty on paths without per-recipient engagement-tier lookup.

**Template system** 🔴
No email-blast template library. `convex/templates.ts` is campaign-template (action letters), not reusable email blast bodies. No save/load for blast composition. Draft autosave (localStorage 2s debounce, 7-day TTL) is the only persistence.

**Email engine** 🟡

- **Path A (client-direct, <500 recipients):** browser decrypts via org key → `sendBlastFromClient` in `src/lib/services/client-blast-sender.ts` → Lambda proxy → SES. Batch 50. **Gap: ses-proxy Lambda not deployed.** `PUBLIC_SES_PROXY_URL` empty in prod.
- **Path B (Convex server-side, ≥500 or fallback):** `sendBlastBatch` in `convex/email.ts`. Batch 100. Hand-rolled SES v2 HTTP with Sig V4. 30s per-recipient timeout. Batches chain via `scheduler.runAfter(0)`. The sender decrypts recipients, applies merge fields, builds per-recipient HMAC unsubscribe URLs, and includes `List-Unsubscribe` + `List-Unsubscribe-Post` through SES v2 `Simple.Headers`; it fails closed before sending if `UNSUBSCRIBE_SECRET` or `PUBLIC_BASE_URL` is invalid. The org composer now has a role-checked, runtime-gated enqueue boundary: `FEATURES.EMAIL_SERVER_DISPATCH=true` exposes the server sender, while `getEmailServerDispatchReadiness` requires AWS SES credentials, org-key verifier, a ≥32-byte `UNSUBSCRIBE_SECRET`, and a valid `PUBLIC_BASE_URL` before `email.enqueueServerDispatch` can claim the draft as `scheduled`. Missing runtime dependencies return typed `email_server_dispatch_dependency_missing` with the preserved draft link instead of queueing a failing worker, and the org OS layout carries the exact `missing`, `dependency`, and `message` fields into the capability map and composer readiness rows instead of collapsing them into a generic proxy gate. **Gaps:** runtime configuration and T2-4b provider rendering still need production verification, and the separate client-direct ses-proxy Lambda deployment remains an ops boundary.
- **Path C (TEE-sealed):** `sealAndScheduleBlast` in `convex/blasts.ts`. Not deployed (enclave not live).
- Rate limit: 5 sends/org/hour. Failure: blast → `failed`, no auto-retry.

**ses-proxy Lambda** 🔴 (not deployed)
Code complete at `infra/lambda/ses-proxy/index.ts`: dispatch-claim verification with `BLAST_DISPATCH_SECRET` + rotation-window previous, per-recipient cohort hash, `List-Unsubscribe` MIME injection, CORS pinned to `https://commons.email`. **Status:** not deployed in account `529088283822`. `BLAST_RECEIPTS_SECRET` sync waits on deployment.

**A/B testing** 🟡
UI toggle in compose, separate subject A/B inputs, variant tabs for body, configurable split (10–90%) + test group (10–50%) + supported winner metric (open/click only) + duration. Winner metrics are open/click only until verified-action attribution is joined; older records that name a verified-action metric surface as a boundary and require a recorded winner id before remainder materialization. The composer creates two linked draft rows with `abParentId`, exact `includeEmailHashes` recipient filters for the test variants, and an `emailAbTestCohorts` snapshot with the held-back remainder; its setup copy labels that remainder as an exact continuation cohort, not manual follow-up. The email index now exposes `#ab-continuation-boundary` from the shared `buildSendReadiness` A/B mode before the record list, with counted A/B groups and variant drafts from `email.listBlasts`; Launch pressure and Send readiness route there instead of treating the compose toggle as automated dispatch. The email detail route now opens A/B groups with **A/B continuation pressure** cells for Snapshot ground, Held remainder, and Dispatch gate before variant scorecards or queue controls. `pickAbWinners` marks sent sibling variants with `abWinnerPickedAt` and stores `winnerBlastId`; `/org/[slug]/emails/[blastId]` loads the sibling group, cohort counts, recorded winner id, can create an exact remainder draft from the winning content, and has exact test/remainder queue actions wired to the runtime-gated server-dispatch boundary. **Critical gap:** production A/B side effects remain dependency-bound until the same server email runtime checks pass; no build claims automatic test-cohort or winning-remainder sends when SES/org-key/unsubscribe dependencies are missing. Plan gate: A/B requires Starter+.

**Subject line generation** ✅
Gemini-backed agent at `src/lib/core/agents/agents/subject-line.ts` with structured JSON output. Multi-turn clarification. Retry with forced-output. Rate limit 5/org/hour. **Note:** invoked from campaign Template Creator flow, not from blast compose UI directly — there is no AI suggestion button in the blast subject field.

**Email validation pipeline (Reacher)** 🔴
`infra/reacher/fly.toml` defines a Fly.io deployment for `reacherhq/backend:latest`. `reacherData` field exists on schema. **No application code calls Reacher.** Wrangler secrets documented in comments but not referenced anywhere. Undeployed, unwired infra spec.

**Bounce + complaint handling** 🟡
`processSesWebhook` in `convex/webhooks.ts` receives SNS notifications. SNS signature verification at `_snsVerify`. Permanent bounces update supporters by canonical global email hash, transient/undetermined soft bounces increment `softBounceCount` and suppress on the 3rd hit with a 30-day TTL, and complaints always win. Suppression flows through `emailStatus` filtering on recipient resolution. `processBounceReports` no longer no-ops manual reports: it groups unresolved `bounceReports`, suppresses only after two independent verified reporters, patches matching supporters by `globalEmailHash`, and marks contributing reports with `probeResult: suppressed_by_consensus`. **Gap:** SMTP probing/Reacher verification is still not implemented.

**Deliverability infrastructure** 🟠
DKIM/DMARC/SPF are SES account-level config, not app code. **No per-org custom sending domains:** every org's from is `${org.slug}@commons.email` (hardcoded in 3 places in compose `+page.server.ts`). No domain warmup. No engagement-based throttle. List-Unsubscribe: Lambda path includes it (Lambda not deployed); Convex server-side path now includes the header substrate but production dispatch and T2-4b provider rendering remain gated.

**Scheduling** 🟠
`scheduledAt` field exists on `emailBlasts`. `sealAndScheduleBlast` accepts it. `processScheduledBlasts` cron runs every minute, queries `by_status` for `scheduled` rows with `sendMode === "tee-sealed"`. CAS via `claimForBlastDispatch`. **Gap:** only TEE path supports scheduling and TEE is not deployed. Client-direct path has no scheduling. No timezone conversion. No scheduling UI.

**Send-time optimization** 🔴
Not built.

**Send-limit enforcement** ✅
Limits at `src/lib/server/billing/plans.ts`: Free 1K, Starter 20K, Org 100K, Coalition 250K. `checkPlanLimits` query at start of `send`/`sendAbTest`/`createClientDraft`. Defense-in-depth check in `sendBlast`. Period-scoped from `emailBlasts.sentAt`. 403 with clear error on quota exceeded.

**Open/click tracking** 🟡
Schema: `emailEvents` table with eventType (open/click), blastId, recipientEmailHash, linkUrl, timestamp. `emailBlasts.totalOpened/totalClicked` aggregates. Webhook handlers in `webhooks.ts`. Dedup per `(blastId, recipientEmailHash, eventType)`. **Mechanism:** SES event-driven via SNS — no app-level pixel injection. **Gap:** open event attribution iterates last 20 blasts checking `blast.batches.length > 0` as a heuristic for client-direct attribution; a server-side blast with `batches: undefined` would silently drop open events. Click tracking requires SES Configuration Set with click tracking enabled — operator config, not app-enforced.

**Email Q&A / accessibility / checklist gate** 🔴
No pre-send checklist, admin sign-off gate, accessibility checker, or alt-text enforcement. Parallel to AN's December 2025 delivery-checklist feature.

### 4. Decision-maker + Power Landscape + letters

**Postal Bubble** 🟠
State machine + bubble client at `src/lib/core/bubble/bubble-state.svelte.ts`. Geometry module at `src/lib/core/bubble/geometry.ts`. `PrecisionLevel` type (none/postal/ambiguous/resolved). **Spec at `docs/specs/POSTAL-BUBBLE-SPEC.md` is explicitly marked "ASPIRATIONAL."** The interactive "pinch to resolve" UX, draggable bubble, district fence visualization don't exist as routes. Current production uses `AddressCollectionForm` + `resolveAddress` directly. Postal disambiguation when one ZIP spans multiple districts: data layer ready (`lookupAllDistricts`), no UI presents the choice.

**Shadow Atlas integration** ✅ (read path)
IPFS-native. `latLngToCell(lat, lng, 7)` → `getChunkForCell` fetches ~8 KB H3 res-3 parent chunk from R2 via `src/lib/core/shadow-atlas/ipfs-store.ts`. Zero runtime server calls. LRU cache 50 chunks, 7-day TTL. All 24 slots defined in `US_SLOT_NAMES`. Boundary GeoJSON served from `atlas.commons.email/source/{version}/us/cd/cd-{geoid}.geojson` (congressional only). Browser-direct fetch with 5s timeout + cache-poison guard. Write path 🟡: HTTP POST to `WRITE_RELAY_URL`; requires `SHADOW_ATLAS_API_URL` + `SHADOW_ATLAS_REGISTRATION_TOKEN` env vars.

**Decision-Maker resolution (3-phase agentic)** ✅
At `src/lib/core/agents/agents/decision-maker.ts`. Phase 1 role discovery → Phase 2a parallel Exa identity → Phase 2b mini-agent contact hunting (1 search + 2 reads per identity budget) → Phase 3.5 email deliverability via `verifyEmailBatch` → Phase 4 accountability openers at `decision-maker-accountability.ts`. LLM: Gemini via `decisionMakerRouter.resolve()`. Exa search + Firecrawl client (singleton).

**DecisionMaker entity** 🟡
Realized through `ProcessedDecisionMaker` in `src/lib/types/template.ts`. Holds name, title, organization, email, emailVerified, source, reasoning, accountabilityOpener, roleCategory, relevanceRank, publicActions, personalPrompt. **No separate `decisionMakers` Convex table** — DMs live as resolved JSON on templates and `recipientConfig.recipients` on campaigns. `convex/resolvedContacts.ts` is a contact cache, not a universal DM registry.

**Officeholder data source** 🟡
**Federal only.** `congress-legislators` dataset pre-ingested, served as per-district JSON from R2 via IPFS chunk pipeline. Fields: `bioguide_id`, `name`, `party`, `chamber`, `state`, `district`, `phone`, `contact_form_url`, `website_url`, `cwc_code` (null — computed at XML generation time from state/district pattern), `is_voting`, `delegate_type`. **No Cicero/BallotReady/OpenStates integration.** State + local officials resolved entirely via Phase 2 agentic Exa web search — no structured database backing them.

**Letter campaign creation** ✅
TemplateCreator → UnifiedObjectiveEntry → DecisionMakerResolver → DecisionMakerResults → MessageGenerationResolver → SlugCustomizer. `deliveryMethod` set to `'cwc'` when target includes Congress; `'email'` otherwise. mDL/identity gate: CWC requires Tier 2+; Tier 4+ triggers `ProofGenerator` with `autoStart`. Preview via `MessagePreview.svelte` / `ComposePane.svelte`.

**CWC submission pipeline** 🟠
`CWCXmlGenerator` class in `convex/_cwcXml.ts`. Generates House XML (CWC v2.0 with `AddressValidation`, `Organization` fields) + Senate XML (simpler schema). `generateOfficeCode` computes `H{STATE}{DISTRICT##}` for House. `validateXML` does string-presence checks. `submissions.getCongressionalDeliveryReadiness` exposes a no-secret runtime posture for the org OS: congressional launch flag, House proxy env (`GCP_PROXY_URL` + `GCP_PROXY_AUTH_TOKEN`), and Senate API env (`CWC_API_BASE_URL` + `CWC_API_KEY`). `buildSendReadiness` now treats CWC as live only when that Convex runtime posture, `FEATURES.CONGRESSIONAL`, and the congressional launch gate are all ready, and its no-id handoff routes to `/campaigns/new#proof-delivery-boundary` with `prepare proof handoff` rather than the generic action-record list. The new action route reads the same readiness query and shows launch/proxy/API posture before the form can imply CWC side effects. Each actual delivery still re-checks template publication, witness freshness, proof/credential state, chamber scope, representative routing, and transport before side effects. **Transport env vars are not configured in the current launch posture and `FEATURES.CONGRESSIONAL=false`; zero congressional messages can be delivered to any office today.**

**Encrypted witness** ✅
`convex/submissions.ts:create` accepts proof, publicInputs, nullifier, encryptedWitness, witnessNonce, ephemeralPublicKey, teeKeyId. Size caps enforced. Active-credential gate. Tier 4 minimum.

**Web form navigation** 🔵
Explicitly out of scope per product-roadmap. Firecrawl client exists for DM resolution document processing; not for legislative web-form submission.

**Power Landscape composition UX** ✅
Multi-step flow per MEMORY.md: TemplateCreator orchestrates; UnifiedObjectiveEntry single entry; DecisionMakerResolver streaming SSE + ResearchLog thought segments; DecisionMakerResults with DecisionMakerCard/Grouped + CustomDecisionMakerForm; MessageGenerationResolver with subject line agent. `emphasis: federal/state/local/neutral` field in TemplateFormData. ROLE_DISCOVERY_PROMPT explicitly reasons cross-jurisdiction fallback.

**mDL verification at send** 🟡
For CWC: `REQUIRED_CONGRESSIONAL_PROOF_TIER = 4`. Tier 2 users see upgrade prompt. Non-CWC letter campaigns (email delivery) have no ZK proof requirement — `verified` boolean comes from `trustTier >= 2`, not from proof verification at send time.

**Country-code support** 🟠
**US only in production.** `LIVE_RESOLVER_COUNTRIES = ['US']` in `src/lib/server/geographic/types.ts` blocks CA/GB/AU. Resolver code + DISTRICT_CONFIG entries exist for `uk-postcodes`, `au-aec`, but `lookupRepresentatives()` now fails closed with `REP_LOOKUP_NOT_CONFIGURED` instead of returning an empty representative set. International route returns HTTP 503. Per `rep-lookup.ts` comment: planned sources remain TheyWorkForYou (UK), OpenParliament (CA), and openaustralia.org.au (AU).

**Local government coverage** 🟡
24 slots defined in `US_SLOT_NAMES` (congressional → special districts including water/fire/transit/hospital/library/park/judicial/tribal). H3 cell chunks carry all 24 slots **if populated**. **Only congressional (slot 0) is actually ingested via `congress-legislators`.** State + local officials reach the user only via agentic Exa search.

**District membership proof** 🟡
Three-tree Poseidon2 ZK circuit in `@voter-protocol/noir-prover`. `prover-client.ts` generates proof using cell_id, user_secret, registration_salt, Merkle path. `districtCommitment` is a circuit input. Congressional submissions carry full proof + nullifier. **Non-congressional letter campaigns: `createCampaignAction` carries `districtHash` + `h3Cell` but NOT a full ZK proof.** `verified` from `trustTier >= 2`, not from per-action proof verification.

**Patch-through calling** 🟡
`initiatePatchThroughCall` at `src/lib/server/sms/twilio.ts`. Direct Twilio REST (no SDK). TwiML: `<Say>` greeting with optional district verification → `<Dial>` to target. `convex/calls.ts` stores records and pins status to Twilio's documented set. Signature validation exists. Requires `TWILIO_ACCOUNT_SID/AUTH_TOKEN/PHONE_NUMBER`. Independent of CWC. **Boundary:** `/org/[slug]/calls` is an honest call-record surface, not an armed call station. `buildCallRoutingReadiness` lifts the same call-initiation boundary into rows for call-record history, caller-phone custody, bridge transport posture, initiation preflight, and call scripts/queues. The call page now starts with **Call routing pressure** cells for Record ground, Caller custody, and Next call lift, derived from those rows before the initiation boundary, queue boundary, or call history table. The org layout now loads aggregate-only call posture plus `getCallInitiationReadiness` into `OrgSpacesData.operating.callRouting`, and the Capability map, Spotlight, Mantle operating readout, operator queue, and claim-basis ledger consume that same object at `#capability-call-routing` without loading plaintext phones. `POST /api/org/[slug]/calls` requires `callerPhone` after org-key decryption and now preflights the same readiness contract before creating a call record, returning typed 424 `call_initiation_not_armed` when initiation evidence is missing rather than a 501 stub. The page does not yet mount supporter phone lookup plus browser decrypt, so call initiation stays dependency-first behind `read call-initiation boundary`.

**Multi-jurisdiction routing** 🟡
Data layer: `lookupAllDistricts()` returns all 24 populated jurisdictions per H3 cell. DM Phase 1 prompt reasons across layers. Campaign layer: single `deliveryMethod` per template. **No multi-leg dispatch concept.** Sending the same message to federal + state + local simultaneously requires separate templates.

### 5. SMS / calling / events / fundraising

**SMS blast send** 🟡 (bounded carrier dispatch path + draft-detail browser sender; broad dispatch still gated)
`convex/sms.ts` CRUD works. `sendSms` at `src/lib/server/sms/twilio.ts:51` exists, and `src/routes/api/org/[slug]/sms/[id]/+server.ts` can now dispatch bounded browser-decrypted recipient batches through Twilio when the text dispatch gate, Twilio transport credentials, and route-local decrypted E.164 phones are present. The route writes message rows and cumulative blast counters through `sms.recordDispatchBatch`, which re-checks editor authority, org ownership, supporter scope, duplicate prior receipt rows, and `smsStatus === 'subscribed'` before persisting receipts. The SMS composer counts saved tag/segment audience filters through `sms.countEligibleRecipientsForFilter`, persists that scope on draft creation, and can hand the operator to the detail dispatch boundary. The SMS index/compose/detail routes now start with **Text delivery pressure** cells for Packet scope, Phone custody, and Next proof lift, derived from `buildTextDeliveryReadiness.proofRows` plus route-local draft body/audience evidence on compose, before dispatch boundaries, draft lists, detail counters, carrier proof rows, or browser-send controls. The SMS list card and detail evidence grid hide accepted/confirmed/failed carrier counters until receipt rows or nonzero carrier outcomes exist, showing saved scope, browser route, and held-check custody evidence instead, so a draft cannot read as a zero-delivery send. The SMS index/detail surfaces also render the shared `buildTextDeliveryReadiness.proofRows` contract so saved draft packet, audience scope, browser phone custody, scope revalidation, carrier acceptance, reply register, and receipt anchoring are visible before a text is treated as leaving Commons. The SMS detail route mounts the browser cohort sender for draft/sending records: it calls `sms.getEncryptedRecipientsForBlast`, prompts for the org key, decrypts encrypted phone blobs in the browser, refuses partial decrypt/format failures, and posts only bounded 100-recipient E.164 batches to the dispatch API until the saved eligible cohort is recorded. Missing runtime evidence returns structured HTTP 424 `text_dispatch_not_armed` with `blockedVerb: carrier_delivery`, `preservedArtifact: sms_draft`, `gate: CP-sms-dispatch`, `taskIds: ['T2-1']`, `missing`, `dependency`, `runtimeFlag`, `runnerImplemented`, and `clientDecryptorMounted`. Reason: org-PII encryption means the server cannot decrypt supporter phones for batch send; the detail route can supply route-local decrypted batches, while broad carrier delivery remains gated by dispatch readiness and route-local checks. `getTextDispatchReadiness` therefore keeps OS surfaces draft-only by default while the detail route can execute supplied decrypted cohort batches.

**A2P 10DLC compliance** 🔴
No brand registration schema, no TCR submission flow, no sample message storage. Public org product copy now names custody-bound text dispatch instead of 10DLC readiness. No Twilio Messaging Service SID configuration. Single from-number via `TWILIO_PHONE_NUMBER` only.

**SMS recipient filtering** 🟠
`smsStatus` field present on `supporters`. STOP/START handling correctly sets `smsStatus: stopped`. `recipientFilter` on `smsBlasts` (tags/segments/excludeTags). The draft-detail browser sender now reads the saved `recipientFilter`, limits dispatch to subscribed encrypted-phone rows, applies tag/segment/exclude-tag filters, and continues through the saved eligible cohort in 100-recipient browser requests. The dispatch API reloads the next encrypted cohort before Twilio sends and rejects decrypted supporter IDs outside that saved-audience batch. Composer-side cohort selection is mounted as a counted saved filter; broad one-click carrier dispatch remains gated.

**Text delivery OS posture** 🟡
`supporters.getSummaryStats` now exposes aggregate `smsHealth` (`subscribed`, `unsubscribed`, `stopped`, `none`, `phonePresent`) and aggregate consent-evidence counts without plaintext phone values, and the org layout loads aggregate SMS draft/recipient/receipt/reply counters plus `getTextDispatchReadiness` runtime details from `sms.listBlasts` into `OrgSpacesData.operating.textDelivery`. The same slice now carries `dispatchClientBatchRouteMounted` so OS surfaces can show the mounted draft-detail browser sender as bounded route evidence without claiming broad carrier automation. `buildTextDeliveryReadiness` drives the Studio capability card, `#capability-text-delivery` matrix, operator queue, claim basis, Mantle operating readout, Spotlight command, the route-local **Text delivery pressure** cells, and the carrier proof contract at `#text-carrier-proof-contract`. This is posture plus a bounded carrier-dispatch substrate: phone consent status, imported consent evidence, draft packets, audience snapshots, carrier counters, reader reply register, dispatch runner, and receipt anchoring are distinct rows, while the proofRows contract separately exposes saved draft packet, audience scope, browser phone custody, scope revalidation, carrier acceptance, reply register, and receipt anchoring; visible carrier delivery remains dependency-first while transport credentials, the dispatch feature gate, carrier evidence, or route-local dispatch checks are missing. Route-local SMS counters follow the same rule: carrier counters stay hidden until receipt rows or nonzero carrier outcomes exist, so saved scope cannot masquerade as a zero-row dispatch.

**SMS inbox / reply handling** 🟡
Inbound SMS webhook at `convex/http.ts` → `webhooks.handleInboundSms`. STOP/START/UNSUBSCRIBE update SMS status for TCPA, and non-control free-text replies are stored in `smsReplies` as bounded reader response evidence when the org can be resolved from the Twilio destination number or a unique phone match. The org SMS index and detail routes expose `#text-replies` through `sms.listReplies` without plaintext phone numbers. **No admin reply queue, autoresponder, assignment workflow, legal-policy review, or reader-office notification loop.**

**MMS support** 🔴 — `sendSms` sends text body only. No `MediaUrl` parameter.

**SMS quota enforcement** ✅ (tracked) / 🟠 (moot)
Plans: free=0, starter=1K, org=10K, coalition=50K. `checkPlanLimits` aggregates from `sentCount`. PATCH route checks quota before sending a client-decrypted batch and rejects batches that would exceed the period limit.

**Patch-through calling** 🟡 (covered in §4; transport exists, org UI initiation is dependency-first)

**Phone banking / predictive dialer** 🔴 — Not built. No dialer, no volunteer assignment, no call queue, no session concept.

**Click-to-call** 🔴 — Not built. No embeddable widget or API.

**Call campaign UI** 🟡
`/org/[slug]/calls` is call-record history with a route-level capability strip, **Call routing pressure** cells, and an explicit initiation boundary. The OS map also surfaces **Call routing posture** from `buildCallRoutingReadiness`: call records, caller-phone custody, Twilio transport, call-initiation preflight, and phone-bank workflow remain separate rows. No connect button is exposed until `getCallInitiationReadiness` can clear call authority, supporter phone custody, caller confirmation, mounted connect controls, and Twilio transport evidence. No script builder, no call list management, no volunteer assignment.

**Event CRUD** ✅
`convex/events.ts` create/update/list/get. Supports IN_PERSON/VIRTUAL/HYBRID. Status FSM (DRAFT → PUBLISHED → CANCELLED/COMPLETED). Auto-generated `checkinCode` on creation. Valid event types enforced.

**RSVP collection** ✅
`createRsvp` at `events.ts:508`. Encrypts email + name with org key. Email-hash dedup. Rate-limited 10/minute per email+event. Respects capacity. Status: GOING/MAYBE/NOT_GOING/WAITLISTED. Walk-in sentinels via `publicCheckIn`. **Gap:** WAITLISTED has no auto-promotion when capacity opens (documented at line 416).

**Event map** 🔴 — `latitude`/`longitude` on schema. No map rendering on org events route.

**Attendee management** 🟡
`getRsvps` query paginated with status filter. Check-in functional. Org detail route now exposes a bounded CSV export at `/org/[slug]/events/[id]/attendees.csv` with RSVP/walk-in attendance evidence and no decrypted email/name columns. **Gaps:** no full-text search, no decrypted attendee export, no dedicated walk-in UI, and no QR-rendered check-in surface.

**Calendar export** 🟡 — Org detail route now exposes an ICS download at `/org/[slug]/events/[id]/calendar.ics` for the event record. No Google/Outlook account integration or provider-side sync.

**Hybrid events** ✅ — Schema enum + create/update support. `virtualUrl` alongside physical address.

**Event campaigns** ✅ — `events.campaignId` FK to `campaigns`. Aggregation dashboard not built but data model supports it.

**Attendance verification** ✅
`checkIn` mutation accepts `verificationMethod` + `identityCommitment` + `districtHash`. Increments `verifiedAttendees` separately. `publicCheckIn` derives `verifiedTrust` server-side from check-in code match. K-floor 5 on public counter. **End-to-end ZKP flow through check-in UI not yet plumbed.**

**QR check-in** 🟡 — `checkinCode` shown as plaintext to editors at `events/[id]/+page.svelte:78-81`. `/api/e/[id]/checkin` POST accepts the code. No QR image rendered.

**Stripe checkout** ✅
`donations.processCheckout` action. Validates campaign, encrypts PII, creates Stripe Checkout Session (raw fetch to `api.stripe.com/v1/checkout/sessions`). Supports `payment` + `subscription` modes. Amount bounds $1–$1M. Webhook at `/webhooks/stripe` handles `checkout.session.completed` → `webhooks.completeDonation`. Refund via `charge.refunded`.

**Donation forms** ✅ — `/d/[campaignId]/+page.svelte` is a public donation page. Preset + custom amounts. Recurring toggle. **Gap:** no embeddable iframe widget surface.

**Recurring donation management** 🟡
`recurring: true` + `recurringInterval` creates Stripe Subscription. `stripeSubscriptionId` stored. **Gap:** no cancel-subscription UI in org dashboard (Stripe portal only). No failed-payment retry beyond Stripe's own. No subscriber roster view.

**Donation confirmation / receipt posture** 🟡
`completeDonation` schedules legacy-named `internal.donations.sendReceiptEmail` after Stripe completion. The action now claims and records a baseline donor-confirmation outcome on the donation row (`confirmationEmailStatus`, attempted/sent timestamps, failure reason), and the fundraising index/detail surfaces summarize sent/skipped/failed/untracked outcomes only after `donations.getConfirmationSummary.completed` is non-zero. Successful SES sends also store `confirmationEmailProvider='ses'` plus `confirmationEmailProviderMessageId`, which surfaces as provider-accepted send evidence on the fundraising index/detail and donor table. When completed-donation or provider-accepted confirmation evidence is absent, saved fundraising index/detail routes hide the sent/skipped/failed/untracked/provider-accepted counters and show completed-row ground, receipt-policy custody, and held receipt-proof rows instead, so an empty fundraiser cannot read as a zero-send receipt register. Fundraiser records can also carry `campaigns.donationReceiptPolicy` as operator-authored receipt-policy text; when configured, that text renders inside the baseline donor confirmation email with an explicit Commons boundary statement. `buildFundraisingReadiness.rows` now drives the route-local `WorkspaceCapabilityStrip` on the fundraising index/create/detail routes, and `buildFundraisingReadiness.proofRows` drives the route-local proof contract at `#fundraising-receipt-proof-contract` plus the Capability map receipt-proof strip. The create route uses those same proof rows for route-local pressure cells before the form, anchored to definition, publication, checkout, and receipt boundaries rather than rendering the saved-record proof matrix. Together they separate fundraiser record ground, public intake scope, payment-provider handoff, webhook completion, confirmation outcome register, provider send acceptance, receipt-policy custody, and tax/anchoring boundary. The Launch pressure / Launch vector **Donation receipt compliance** row routes to `#fundraising-receipt-boundary`, where confirmation outcomes, provider send evidence, receipt-policy custody, and tax/anchored receipt limits sit together. This is transactional confirmation, provider acceptance, and policy custody only: no EIN/tax validation, no legal review, no IRS §170(f)(8) acknowledgment proof, no mailbox delivery proof, and no anchored receipt trail.

**Fundraising campaign analytics** 🟡
`listByOrgWithDonors` returns `raisedAmountCents`, `donorCount`, `goalAmountCents`. **Gap:** no recurring conversion rate, no time-series donor charts, no average gift, no geographic breakdown.

**ActBlue integration** 🔴 — No API client, no redirect integration.

**Platform fee** ✅
0% confirmed in `src/lib/config/features.ts:62` and developer docs. No Commons-side fee logic in `processCheckout`.

**Event-driven workflow engine** 🟡
`convex/workflows.ts` full CRUD: create/update/setEnabled/execute, processScheduled cron. **`FEATURES.WORKFLOW_EXECUTION=true` now arms the bounded non-email runner:** enabled workflows can be scheduled from trigger dispatch, branch deterministically, write/remove org-scoped supporter tags idempotently, pause on delay, resume through the workflow scheduler, and write action logs/run rows. **Workflow `send_email` remains dependency-bound**: the detail PATCH route preserves definition updates, permits arming for non-email workflows, and returns typed `workflow_email_dependency_missing` for email-bearing definitions when `getWorkflowEmailRuntimeReadinessFromEnv` finds missing AWS SES credentials, configured workflow/from address, or org-key verifier. The failure payload includes `missing` arm-time dependencies and separates per-run requirements (`supporter cursor`, subscribed supporter, org-key decrypt, per-recipient email decrypt). The workflow index, builder, and detail server loads compute the same sanitized readiness and render `WorkflowEmailDependencyPanel` when email steps are present, so the visible surface names the same dependency boundary the PATCH route enforces. The execution action still re-checks supporter cursor, subscribed supporter, org key, SES credentials, and configured workflow/from email before sending.

Step types: `send_email`, `add_tag`, `remove_tag`, `delay`, `condition`. **`delay` works fully** (1 min to 30 days). **`condition` has a deterministic evaluator for trigger/execution field paths.** **`add_tag` and `remove_tag` apply idempotent org-scoped `supporterTags` writes when the runner has a supporter cursor.** **`send_email` is single-recipient and dependency-bound; it is not a blast fanout, does not bypass unsubscribe state, and fails loudly if SES/org-key/from configuration is absent.** `/api/automation/process` authenticates the external cron, calls the Convex scheduled-resume wrapper, and returns processed-run evidence; its closed-gate fallback is a typed 424 `workflow_execution_not_armed` boundary, not a 501 stub. Final `partial_no_op` is now reserved for legacy unsupported step rows that predate write-time validation.

**Drip sequences** 🟡 — Delay works; workflow email is single-supporter and dependency-bound behind the execution gate.

**Trigger dispatch** 🟡 — `supporter_created`, manual `tag_added`, `campaign_action`, `event_rsvp`, `event_checkin`, and `donation_completed` events create workflow executions and schedule the runner for enabled workflows. Optional tag, action-record, event-record, and funding-action scopes narrow matching before execution. Non-email workflows can now be visibly armed; workflows containing `send_email` require the email runtime dependency boundary to pass before arming.

**Automation UI** 🟡 — Visual builder present at `src/routes/org/[slug]/workflows/`. Workflow creation + listing work. The workflow index, builder, and saved workflow detail route now derive their local capability strips from `buildCoordinationReadiness`; the index server load supplies aggregate step-type counts for email steps, tag writes/removals, branch conditions, trigger families, and execution rows without loading supporter payloads, the builder passes local draft definition/trigger/step counts into the same rows before remapping row hrefs to builder anchors, and detail passes one saved definition, its step mix, enabled flag, trigger family, and run-record count into the same builder before remapping row hrefs to local anchors. They now open with **Coordination readiness pressure** cells for Definition ground, Side-effect runner, and Next run lift before the definition list, builder controls, execution boundary, detail summary, or run log. When email steps exist, the same routes render `WorkflowEmailDependencyPanel` with `workflowEmailReadiness`, email-step count, current missing arm-time dependencies, and per-run checks before an operator can enable or inspect the definition. The list joins `workflowExecutions` by definition and shows run-record counts as evidence when rows exist. A saved `enabled` flag is not displayed as armed execution unless `WORKFLOW_EXECUTION` and the `CP-workflow-effects` gate are both live: held routes show **enabled draft**, while gate-backed execution shows **runner enabled**. Non-email definitions can be visibly enabled through the bounded runner; workflow email remains dependency-bound through the email proxy/runtime boundary. Launch pressure and Send readiness route workflow side effects to `#workflow-execution-boundary` rather than the saved-definition list, so the operator lands on side-effect posture and email dependencies before treating a workflow as armed.

Workflow builder and detail strips also use `read execution boundary` for side-effect runner rows, matching the shared Send readiness and launch-pressure action grammar. Generic `read boundary` is not used for workflow execution because saved definitions, trigger clauses, runner side effects, run evidence, and workflow email dependencies are separate contracts.

**Multi-org networks (Coalition tier)** 🟡
`orgNetworks` + `orgNetworkMembers` tables. Owner + member orgs with roles (admin/member). Invite/accept/leave/remove via `convex/networks.ts`. Public API `GET /api/v1/networks/[id]/stats` and org-facing `GET /api/org/[slug]/networks/[networkId]/report` return active-member aggregate stats from `convex/networks.getStats`: member count, total/unique/verified supporters, total/verified campaign actions, country buckets, district count, and GDS/ALD/temporal entropy/CAI. Network detail also loads bounded `convex/networks.getProofPressure` rows from active-member `accountabilityReceipts`, grouped by decision-maker with per-org strongest receipt weight, verified action evidence, district-count signals, receipt count, and bill alignment. This is receipt-backed pressure evidence only. **Gap:** no cross-org supporter sharing, no federated list queries, no data-sharing permission model, no snapshot cache for large coalitions.

**Shared supporter pools** 🔴 — Not built.

**Cross-org reputation portability** 🔴
Engagement tiers remain per-org. Coalition stats aggregate proof-bearing supporter/action counts across active member orgs, unique by `globalEmailHash` and district-deduped by `districtHash`, but there is no portable supporter reputation object, cross-org engagement history, or federated supporter query.

**Coalition verification aggregation** 🟡
Aggregate coalition proof stats are live through `convex/networks.getStats`, public v1 stats, and the org-facing report route. Network detail proof-pressure rows are live through `convex/networks.getProofPressure`, but the bounded claim is receipt-backed decision-maker pressure, not a shared CRM or durable coalition artifact: no cross-org supporter row sharing, no country-aware receipt rollup, no data-sharing permission model, and no precomputed warehouse/snapshot path for very large coalitions.
Substrate chrome must point to membership/proof handoff plus cross-border gate evidence, not to org-local campaign counts, generic boundary copy, or plan-label placeholders.

**Coalition composition OS posture** 🟡
`buildCoalitionReadiness` lifts network membership and creation posture into the Studio capability map, shell, and saved coalition route strips: active memberships, creation-context record definition and authority, pending invites, member-row aggregate, aggregate proof detail handoff, cross-border routing, and durable artifact boundaries are distinct rows at `#capability-coalition` and in the network index/create/detail `WorkspaceCapabilityStrip` surfaces. The layout derives shell posture only from `networks.list` aggregate fields loaded into `OrgSpacesData.operating.coalition` (`activeNetworkCount`, `pendingInviteCount`, `activeMemberRows`, `topActiveNetworkId`). The network index passes those same loaded list counts into the shared builder and opens with route-local Coalition composition pressure cells before membership cards; the network creation route passes local draft-record state, route-proven creation authority, member proof path, aggregate proof handoff, and local anchors into the same builder with `context: 'creation'`; the network detail passes one saved network plus active/pending member rows into the same row contract, then appends the receipt-backed proof-pressure row from `networks.getProofPressure`. It does not load member supporter rows into the shell and does not claim `networks.getStats` or `networks.getProofPressure` numbers until the user opens the network detail route. This is posture only: active membership is not shared CRM access, receipt-backed pressure rows are not globally deduped constituents or reader-office workflow, and descriptive aggregate stats are not cross-border routing or archive-grade coalition artifacts.

**White-label** 🔴 — Marked gated as a Coalition plan row. No white-label domain routing, no custom branding override, no subdomain config.

### 6. API + embeds + SDK

**REST endpoints surface** ✅
18 documented v1 route files: campaigns, supporters, events, donations, workflows, sms, calls, tags, networks (+ stats), representatives, orgs, usage, keys, docs (OpenAPI), root. Internal `/api/org/[slug]/` surface (30+ routes) is session-auth only — not part of public API.

**Authentication** ✅
Bearer token `ck_live_` prefix. SHA-256 hash lookup against `apiKeys` Convex table via `api.v1api.authenticateApiKey`. Resolves orgId, keyId, scopes[], planSlug. Per-org scoping complete. Scope model: read/write via `requireScope()`. Issuance is session-gated. Last-used tracking fire-and-forget.

**Rate limiting** 🟡
Per-key sliding-window in `src/lib/server/api-v1/rate-limit.ts`:
| Plan | req/min |
|---|---|
| free | 100 |
| starter | 300 |
| organization | 1,000 |
| coalition | 3,000 |

**"Free, no rate cap" product-roadmap claim contradicted** — free plan has 100 req/min. Same per-isolate in-memory limiter; documented residual from 2026-05-16 audit. 429 response includes `retryAfter`.

**OpenAPI / spec** ✅
Full OpenAPI 3.1.0 spec at `src/lib/server/api-v1/openapi.ts`. Served at `GET /api/v1/docs`. CORS `*`, 1h cache. Gated by `FEATURES.PUBLIC_API`. Completeness enforced by `/tests/unit/sdk/openapi-completeness.test.ts`.

**Canonical API origin** ✅
The public API is served by the SvelteKit application at `/api/v1/*`, not by the Convex webhook host. The legacy Convex HTTP routes for `/api/v1/supporters` and `/api/v1/campaigns` now return `308` handoffs to the canonical app origin instead of `501` migration placeholders. This preserves one enforcement point for feature gating, API-key auth, scopes, and plan limits.

**Versioning** 🟡
`/api/v1/` prefix. No deprecation policy. No `/api/v2/`. No sunset headers.

**OSDI compliance** 🔴
No OSDI implementation. Platform export sources such as `action_network`, `everyaction`, `nationbuilder`, `mailchimp`, `salsa`, `mobilize`, `actblue`, `engaging_networks`, `civicrm`, and `salesforce` are CSV-import metadata on people rows, not OSDI resources. No HAL+JSON, no OSDI resource types, no OSDI pagination envelope.

**Webhooks (outbound)** ✅
Inbound webhooks exist (SES/Twilio/Stripe). Outbound org webhooks now use `orgWebhooks` + `orgWebhookDeliveries`, queue org events from core flows, sign deliveries with HMAC-SHA256, support secret rotation, and retry failed deliveries. Session management lives at `/org/[slug]/settings/webhooks`, including a targeted `webhook.test` delivery action for one enabled endpoint; the same operation is available at `POST /api/v1/webhooks/[id]/test-fire` and returns only queued delivery evidence. The operating-authority readiness builder keeps signed webhook posture tied to the event-emission gate instead of the public API flag alone, and `buildSignedWebhookReadiness` drives the webhook management route strip for event substrate, endpoint custody, sender-side attempts, reader-office notification boundary, and durable archive proof without claiming receiver processing. The persistent Signal well reads a session-authenticated recent `orgEvents` slice in layout scope and renders only event kind + timestamp, not payloads or receiver processing. **Gap:** reader-office notification workflows, full SSE stream reattachment in the shell, receiver-side processing proof, and broader event-consumer UX remain product-gated.

**TypeScript SDK** 🟡
Full implementation at `packages/sdk-typescript/`. `Commons` class with 13 typed resource classes. `CursorPage<T>` AsyncIterable for auto-pagination. Typed error classes. `package.json` name `@commons-platform/sdk` v1.0.0. **Not published to npm.** No CI publish step.

**Python SDK** 🟡
Full sync + async at `packages/sdk-python/`. `Commons` + `AsyncCommons`. httpx-based. All 13 resource classes mirrored. `CursorPage` + `AsyncCursorPage`. `pyproject.toml` name `commons-sdk` v1.0.0. **Not published to PyPI.**

**Developer docs** 🟡
SDK READMEs complete with quick-start, resource tables, pagination, error handling. OpenAPI at `/api/v1/docs`. **No "Building on Commons" developer portal** — no tutorial site, no webhook integration guides.

**iframe + postMessage** ✅
`/src/routes/embed/campaign/[slug]/+page.svelte` + CSP override at `src/hooks.server.ts` replaces restrictive `frame-ancestors` with permissive. On success, postMessage `{ type: 'commons:action', campaignId, actionCount }` to `window.parent`. Target origin `*`.

**Campaign widget** ✅
Loads via `api.campaigns.getPublicAny`. Fields: name, email, postal, message, plus optional district-evidence address fields. Rate-limited 10/min per IP. Submits via `api.campaigns.submitAction` with `source: 'widget'`.

**Postal Bubble in widget** 🔴
No postal bubble component in `/src/routes/embed/`. The plain postal field stays postal-only, while the optional district-evidence drawer resolves full address through `POST /api/c/[slug]/verify-district` and submits `districtCode`, `h3Cell`, and `atlasVersion` when successful.

**Identity verification (mDL) in widget** 🔴 — Session-authenticated only. No cross-frame mDL protocol.

**Verified-action embed** 🟠
Embed records actions via `submitAction` with inherited trust tier and optional district evidence. **Embed is anonymous** — no ZK proof generated in-widget, no mDL in-widget. "Verified" in embed = email-deduped or district-evidence-attributed at most, never mDL/ZK identity proof.

**Widget customization** 🟡
URL params: `?bg=RRGGBB`, `?accent=RRGGBB`, `?hide_count=1`. Hex validated. No CSS variable injection, no custom copy, no logo, no font override.

**Widget analytics** 🔴
No per-embed view tracking, impression counting, or conversion rate. Action count surfaced post-submit only.

**Direct platform sync tool** 🟡 (credential custody covered in §1; direct sync gated)

**CSV import with field mapping** 🟡 (UI only — no programmatic API)

**Audit log API** 🔴
No table, no endpoint. Internal ops logged to Sentry + Convex; no structured queryable trail.

**Activity feed** 🟡
`/api/org/[slug]/decision-makers/feed/` (session-auth). Not exposed via public v1.

**Agent trace observability** ✅
`convex/agentTraces.ts` per-event Convex persistence. Indexed by traceId/endpoint/userId/expiresAt. Off-by-default. GDPR cascade via `deleteByUserId`. Hourly TTL cron. Raw operator access remains internal-secret protected via `npx convex run`; Studio now also exposes a same-user redacted browser replay at `/api/agents/traces/[traceId]`. That route calls `agentTraces.listByTrace` with `INTERNAL_API_SECRET`, requires a `trace.start` row whose `userId` matches the signed-in operator and whose endpoint is `message-generation`, and returns only event summaries/payload keys for browser display, not raw prompts or model responses. Studio now receives the `stream-message` `traceId` alongside the recoverable message job and surfaces it as a partial trace-replay handle. The Studio OS registry also stores a bounded device-local process ledger in `localStorage`, rehydrating emitted reasoning/output after refresh while restoring in-flight streams as stopped/detached. `orgOS.studioProcessEvidence` lifts only the focused device-local run into the capability map and Spotlight: process count, contactable targets, dropped public-contact targets, typed resolution-stop posture, typed source-evidence posture, evaluation-fallback posture, candidate/search-query/failed-read audit counts, evaluated sources, search-only fallback sources, emitted paragraphs, draft handoffs, recovery-job status, trace presence, and applied scope. Delegated-agent trace observability remains gated, and server-side durable process persistence remains gated because `agentTraces` does not yet carry delegationGrantId/draftId fields or executor-emitted grant-indexed events, and no backend process table exists.
`buildStudioAuthoringReadiness` now splits that OS-level evidence into rows at `#capability-grounded-authoring`: intent input, model provider, source discovery, page-read evaluation, decision-maker resolve, source grounding, artifact authoring, draft handoff, recovery envelope, trace replay, and delegated-action boundary. Its header renders a `Datum`-backed authoring contract count plus armed/bounded/draft/not-armed mix from `studioAuthoringStateCounts` before the matrix, and its visible title reads **Where intent becomes an accountable authoring run**. Intent input is live operator ground; model/source/page-read rows expose the actual authoring capabilities, while decision-maker resolve, source grounding, artifact authoring, and draft handoff remain partial until a focused process emits contactable targets, source evidence, authored paragraphs, and draft-handoff evidence. Runtime-ready means the loop can start; it is not current-run evidence by itself. The primary Studio start button now sits inside a state-aware action contract that exposes an authoring boundary, intent-required, ready-to-run, or in-progress state with cited metric, action grammar, effect, and gate. Decision-maker resolve, source grounding, artifact authoring, recovery job creation, and trace handles are available only when `OrgSpacesData.operating.authoring` reports model provider, source discovery, and page-read evaluation ready; unread/absent authoring ground is treated as dependency-first, not as a ready fallback. The canvas idle Studio node follows the same rule: without authoring readiness it says intent can be shaped while target resolution, source grounding, and artifact authoring remain dependency-first, not that a live trace will run. When a focused run emits an authored artifact, Studio now opens the artifact surface from `buildMessageGenerationEvidence`; its **Authored artifact posture** rail is `messageGenerationSpineRows` for intent input, target basis, source basis, artifact basis, and delivery handoff, and the detailed matrix renders the same stream-phase, research-trace, recovery-job, trace-handle, and proof-binding rows used by the public creator. `stream-message` preflights `getMessageGenerationReadiness` and returns structured `message_generation_runtime_not_configured` when provider diagnostics are missing; the OS maps those diagnostics to operator-facing model/source/page-read capability language. Draft handoff remains draft-only only after an emitted artifact can be handed to delivery-surface drafts; recovery/trace stay bounded; delegated action remains gated until executor/proof work lands. The shared recovery-job row uses `read recovery boundary` for artifacts without an active recovery job, reserving generic runtime language for actual provider/runtime gates. The public template creator uses the same `buildMessageGenerationEvidence` contract during the live authoring SSE stream, for failed/runtime boundaries, quota boundaries, completed authored artifacts, and resumed Studio public-action drafts, so intent input, selected target basis, a first-class `stream-phase` row, research steps, recovery job state, emitted paragraphs, evaluated source count, search-only fallback source count, trace handle, and artifact proof binding use the same state-label, cluster-label, Ratio/Datum, state-aware action/effect, and `formatGateEvidence` proof-boundary vocabulary instead of component-local copy-generation prose. Resumed Studio public-action drafts and Studio email composer drafts both map handoff rows through `buildStudioDraftHandoffRows`: Draft handoff, Target basis, Source basis, Scope basis, Recovery handle, Trace handle, and Proof binding stay one handoff-aware contract with shared clusters, action grammar, evaluated-source boundary, recovery boundary, trace boundary, and proof gate. The public-action handoff row is draft-only because imported Studio output is not a published action, sent message, receipt, or proof-bearing delivery; the email handoff row is likewise a composer draft, not a sent email or receipt-bearing action. That handoff Source basis row is armed only for evaluated source evidence; search-only fallback rows stay bounded context and no-source drafts show a citation-support gap. The publish endpoint returns saved `sources` and `research_log` with the confirmed template response, and the post-publish modal renders a **Public action publish contract** before share/open controls: Publish record, Action route, Target basis, Source basis, and Proof binding rows show what was saved and what remains route-owned. Failed runs preserve structured response boundary data (`message_generation_runtime_not_configured` or input/stream closure), missing dependency names, retryability, and the surviving evidence rows; non-retryable runtime gaps render as `context / read runtime boundary` instead of a generic try-again button. Rate-limited runs render `draft / read quota boundary`, preserve intent/target evidence rows, and name the quota reset or authoring allowance dependency rather than dropping into a standalone warning card. Source discovery, artifact authoring, completion, and same-device recovery are legible as phase evidence; source counts can advance only from the typed `source-evidence` event after evaluated/preverified source ground exists, while paragraph counts remain tied to the emitted result payload. The OS process runner now also preserves `evaluationFallback`, candidate count, failed-read count, and search-query count from that event, and `buildStudioAuthoringReadiness` folds those facts into the Source grounding row instead of reducing fallback to a count. The completed creator handoff reads `publish public action template`, not generic publish/send language; authored artifacts can create the public action shell, while send, dispatch, receipt proof, and proof-bound execution stay owned by delivery surfaces and send-readiness gates. The activation entry, coordination explainer, and link customizer name the action-page route and state that reader confirmation opens before any send/proof claim. The post-publish modal withholds share controls until the server confirms a public action, labels the primary route as opening the action page, and keeps secondary share/copy controls in action-page language rather than generic link language; the reader completion modal follows the same action-page share/copy vocabulary after confirmation, and its generated share messages describe reader confirmation rather than completed send/delivery. The OS process runner now consumes that same event for Studio process evidence, so in-flight authoring can expose evaluated/search-only posture without treating an absent event as a count. A `source-evidence` zero is a real evaluated zero; no event remains unknown, not zero. The same evaluated/search-only split is carried through the public template creator and authored artifact; fallback rows marked `Evaluation unavailable` are search-only source ground rather than evaluated evidence. The Studio source rail is **Source ground**, not Verified sources, and separates attached, evaluated, adversarial, and search-only fallback rows so failed credibility/incentive evaluation cannot be counted as evaluated evidence. `stream-message` is treated as AUTHOR, not as a substitute for RESOLVE: selected decision-maker count must be present before the authored artifact can read as legitimate target-grounded output.

The public authoring resolver stays in INTENT/preparing until `stream-message` emits phase, source-evidence, recovery, or completion evidence. Runtime preflight boundaries therefore remain provider/source/page-read boundaries rather than claiming GROUND/source-discovery work that never started.

The mounted workspace shell uses `orgOS.SPACE_LABELS` as the stable translation boundary from internal route ids to visible workspace language. Accessible containers, chrome, and the map expose Studio, People, Power, and Results; internal `base`, `landscape`, and `return` ids remain routing implementation details only.

The public action post-publish modal maps Publish record, Action route, Target basis, Source basis, and Proof binding rows through `buildPublicActionPublishContractRows`. Its Source basis row follows the same evaluated-only boundary: evaluated source rows arm it, search-only fallback stays bounded context, and no-source publish responses remain a citation-support gap instead of proof, dispatch, or receipt evidence.

The email composer handoff carries the same source-evidence split in its local `orgEmailComposeDraft` envelope and maps rows through `buildStudioDraftHandoffRows`. Evaluated source rows arm the email Source basis row; search-only fallback and older coarse source counts stay bounded context, while cohort selection, send confirmation, receipts, and proof binding remain owned by the email route.

The mounted Studio header renders `studioHeaderMetrics` as a `Datum`-backed authoring evidence strip: running loops, device-local process records, contactable targets, evaluated sources, and emitted paragraphs cite the OS process registry and focused `stream-decision-makers` / `stream-message` run. Target/source/output metrics stay blank until a focused process emits that evidence; local process counts may be zero because the device-local registry is the cited source.

The shared share-message utility, public action page metadata/counter, pre-auth onboarding modal, and OG image now use route-confirmation grammar: readers confirm routes on an action page, while delivery, receipts, and proof remain route-owned.

The Studio run ledger and authored-output contract now render evaluated source ground and search-only fallback as separate count-bearing evidence. `StudioSpace.svelte` derives `sourceEvidenceObserved`, `sourceEvidenceEvaluationFallback`, source candidate/failed/search-query audit counts, `evaluatedSourceCount`, `searchOnlySourceCount`, `sourceBasisState`, `sourceBasisSignal`, and `sourceBasisDetail` from the focused OS process; the authored-output matrix passes those counts into `buildMessageGenerationEvidence` so the shared Source basis row, not a Studio-only Grounding basis row, owns the evaluated/search-only claim. Search-only fallback can support context, but it is not evaluated source evidence, and the Studio surface must not call all attached source URLs verified. The same Studio ledger rows name delivery-surface draft handoff posture before an artifact exists: no draft write appears before authored output, org authority gates delivery-surface draft handoff, and delivery surfaces still own final audience, preview, send, publish, and proof confirmation.
The canvas `ProcessNode` now carries the same source-ground split in its full-detail face: attached, evaluated, search-only, query, and failed-read counts render as compact `Datum` evidence, and fallback rows receive a visible search-only badge instead of being absorbed into a generic grounded-source total.

`StudioSend.svelte` now consumes the full `buildSendReadiness.modes` contract beside its three concrete Studio handoff buttons. The local buttons stay limited to public-template draft, org-email composer draft, and gated CWC proof delivery; each local button now uses a handoff-effect posture line rather than generic reason labels, naming no authored artifact, missing org authority, unwired delivery-surface handoff, draft-transfer-only, or proof-boundary-only state before the operator reads the deeper gate. The shared mode header renders a `Datum`-backed mode count plus armed/bounded/held split from `deliveryModeRows`, `deliveryModeStateCounts`, and `heldDeliveryModeCount` before the Ratio and row matrix. The shared mode matrix exposes browser-direct email, client-direct merge, server email, A/B continuation, text delivery, event artifacts, workflow side effects, and CWC with state, SEND/AGGREGATE phase, canonical cluster label, handoff, action grammar, effect, metric, and gate. Text delivery is labeled as a custody-bound channel posture rather than an SMS workspace; carrier dispatch remains draft-only until `getTextDispatchReadiness` and `CP-sms-dispatch` are both live. Workflow side effects are armed only when `WORKFLOW_EXECUTION` and `CP-workflow-effects` are both live, while workflow email still passes through its route-local SES/from-address/org-key runtime check. CWC is no longer armed from `CONGRESSIONAL` plus a launch gate alone: Studio Send reads the shared CWC send-mode row, which cites `submissions.getCongressionalDeliveryReadiness` for launch flag, House proxy, and Senate API runtime evidence, and the shared no-id handoff now lands on `/campaigns/new#proof-delivery-boundary` before any action-level proof delivery can be opened. The local Studio CWC action reads `prepare proof handoff` / `read proof-delivery boundary`; it must not say submit congressional delivery because action/report routes own record, packet, recipient, proof, routing, transport, and final submission checks.

When text dispatch is held, Send readiness and Spotlight hand operators to `/sms#sms-dispatch-boundary` with `read text boundary`; saved SMS drafts remain a separate text-delivery readiness affordance, not the dispatch action.

Fundraising route strips now use specific checkout and receipt boundary verbs across the index, builder, and detail surfaces. Stripe/org-key runtime posture reads as `read checkout boundary`; tax acknowledgment and anchored donation receipts read as `read receipt boundary`, so baseline donor confirmations, provider send evidence, and receipt-policy custody cannot be mistaken for mailbox delivery, tax, or anchored receipt proof.

**Custom field schema API** 🟡
`customFields` is opaque `Record<string, unknown>` on Supporter. Accepted in create/update via v1. **No schema management API** — no field types, no enumeration.

**Tag taxonomy API** ✅
Full CRUD via v1. Alphabetical list with supporterCount. 409 on duplicate.

**Convex API exposure** 🟡
All v1 REST calls go through `serverQuery`/`serverMutation`/`serverAction`. Direct Convex client access not offered (no WebSocket). Auth bridge: RS256 JWT.

**Real-time subscriptions** 🔴
Convex real-time used internally only. No SSE or WebSocket under `/api/v1/`. Internal org SSE exists (`/api/org/[slug]/campaigns/[id]/stream/`, alerts stream) — session-authenticated only.

### 7. Billing + dashboard + onboarding + acquisition

**Stripe subscription lifecycle** ✅
All Stripe webhook events handled in `convex/subscriptions.ts:processStripeWebhook`. `mapStripeStatus()` maps incomplete/incomplete_expired/unpaid/paused → past_due. Schedule events handled. Stripe-managed subscriptions refuse direct cancel via Convex (prevents desync). `subscriptions.checkPlanLimits` treats `trialing` as effectively active, so trial orgs receive plan-tier limits during the trial window. **Gap:** grace-period UX and invoice/payment-method management remain Stripe-portal dependent.

**Plan definitions** ✅
`src/lib/server/billing/plans.ts` 4 plans. All 5 dimensions: `maxVerifiedActions`, `maxEmails`, `maxSms`, `maxSeats`, `maxTemplatesMonth`. Coalition $200/mo.

**Convex mirror** ✅
`convex/subscriptions.ts:17-31` mirrors all limits manually with explicit "MUST stay in sync" comment. No automated drift detection. `backfillOrgLimits` to re-sync.

**Customer Portal** ✅
Owner-gated. `stripe.billingPortal.sessions.create()`. Direct downgrade via checkout blocked with 400.

**Billing UI for orgs** 🟡
Settings page shows plan name, status badge (active/past_due/canceled/trialing), renewal date, usage progress bars from `subscriptions.checkPlanLimits` (verified actions + emails + reserved SMS quota), and plan comparison rows with capability states. **Missing:** invoice history, payment method display, no self-service downgrade button (portal-only).

**Webhook handler** ✅
SES bounce/complaint/open/click with SNS dedup. Twilio SMS STOP/START. Donation completion/refund. Stripe correctly delegated to subscriptions.

**Grace period** ✅ (enforcement) / 🟠 (UI)
7-day window via `pastDueSince` field (single-set on first past_due, cleared on active). `effectivelyActive = status==='active' || isWithinGrace`. Settings shows past_due badge but **no countdown banner, no impending-lockout warning.**

**Usage metering** ✅
Period-scoped query-time aggregation — no denormalized counters for verified actions. `verifiedActions` from `campaignActions` via `by_orgId_verified`. `emailsSent` from `emailBlasts.totalSent` where `sentAt >= periodStart`. `smsSent` from `smsBlasts.sentCount`. Free orgs use calendar month; paid orgs use `currentPeriodStart`.

**Quota enforcement gates** ✅
`VERIFIED_ACTION_QUOTA_EXCEEDED` at `submissions.ts:267`. `EMAIL_QUOTA_EXCEEDED` at `email.ts` in the server-side batch sender. `TEMPLATE_QUOTA_EXCEEDED` at `templates.ts:1000`. SMS quota at SMS route. Seat limit at `invites.ts:488-508`.

**Metered overage billing** 🔴 (confirmed gap, by design)
Hard block at quota. Accepted residual per MEMORY.md.

**LLM rate limits** ✅
`src/lib/server/llm-cost-protection.ts`. 3-tier (guest/auth/verified). Per-operation + daily global. 3/10/15 per day daily-global. `message-generation` 0/3/5 per hour. `decision-makers` 0/2/3 per hour. `subject-line` 3/5/5 per hour. Per-user or per-IP for guests. Fail-closed unknown ops. Per-isolate in-memory.

**Seat enforcement** ✅
`memberCount + pendingInviteCount >= maxSeats` check. UI shows seat counter + blocks invite form at limit.

**Template quota enforcement** ✅ — 10/100/500/1000 per plan.

**Verification funnel** ✅
The org OS layout reads `organizations.getDashboardStats` for Results and `supporters.getSummaryStats` for People. The People query returns overlapping evidence counts rather than residual buckets: total people, postal/address evidence, action-record district evidence, identity-commitment evidence, and source-origin counts. Those source counts flow into `OrgSpacesData.base.sourceCounts`, so People and the Capability map read the same no-PII source-custody ground. The dashboard route itself is now an addressability shim; it no longer owns the funnel data.

**Aggregate metrics** 🟡
`getDashboard` returns supporters/campaigns/members/sentEmails from denormalized counters. `getDashboardStats` computes engagement-tier histogram from `campaignActions.engagementTier`. **Gap:** verified percentage and longitudinal coordination trend are not surfaced as first-class dashboard metrics.

**Campaign list with packet status** ✅
Recent 10 campaigns with `actionCount` + `verifiedActionCount`. Per-campaign verified/total bar + status badge. The mounted Results space also selects a top active/recent campaign and computes its packet when campaign data exists.

**Recent activity feed** 🟡
Last 5 supporters as `signup` events. Only `source` as detail. **No verified actions feed, no donations, no email opens.** Type union includes `action` but never populated.

**Dashboard data freshness** 🟡
`getDashboard` is Convex query (reactive) but called via `serverQuery` (SSR, not reactive). Packet KV-cached. Counters denormalized on write.

**Email analytics** ✅
Per-blast totals on `emailBlasts`. `emailEvents` per-recipient. Delivery metrics in `campaigns.getDeliveryMetrics`. Surfaced at `/org/[slug]/emails/[blastId]/`.

**Email delivery evidence posture** 🟡
`buildEmailDeliveryEvidenceReadiness` now drives the email detail and delivery receipt-register `WorkspaceCapabilityStrip` rows from one shared saved-delivery contract. Detail rows separate the blast delivery record, engagement telemetry, receipt evidence, A/B continuation, and list-health response; the receipt-register lens separates delivery record context, loaded `emailDeliveryReceipts` row evidence, immediate dispatch outcomes, hash-only recipient custody, and the anchored receipt-proof boundary. Sent/open/click/bounce/complaint counters stay `email.getBlast` evidence, loaded receipt rows cite `email.listReceiptsForBlast`, and failed/hash rows cite `emailDeliveryReceipts`; none of those rows claim Merkle anchoring, reader-office notification, plaintext recipient access, or archive-grade accountability receipts until the receipt anchoring and reader-response gates clear.

**A/B test evidence** 🟡
Side-by-side variant group inspection, status/sent evidence, config summary, **A/B continuation pressure** cells, stored cohort counts, winner badge after `abWinnerPickedAt` using recorded `winnerBlastId` when present, and exact queue actions for test cohorts plus held-back remainder when server dispatch runtime checks are armed. `FEATURES.AB_TESTING=true`. **Gap:** no production automated winner-send record unless SES, org-key, unsubscribe, and public URL runtime checks pass; verified-action winner selection is not armed; dispatch to the remainder remains dependency-bound.

**Verified action count over time** ✅ (campaign-level only)
`VerificationTimeline` SVG sparkline. Behind `FEATURES.ANALYTICS_EXPANDED=true`. **No org-level time series.**

**Tier distribution over time** 🔴 — Not stored, not charted.

**Coordination integrity scores history** 🟡 — Current scores work; no historical trend.

**Geographic spread** ✅
`GeographicSpread` shows top-10 districts as horizontal bar chart. `VerificationPacket` district map via Leaflet/MapLibre at `DistrictMap.svelte`.

**Per-supporter engagement history** 🟠
Supporter detail page shows profile fields, verification state, tags. **No action history.** `campaignActions` not queried per supporter on this page.

**Campaign-level analytics dashboard** 🟡
Delivery metrics (gated by `ENGAGEMENT_METRICS=false`), verification timeline, geographic spread, coordination integrity. "Dashboard no competitor can build" claim partially real.

**Export — CSV / PDF / API** 🟡
CSV import exists. **No supporter or analytics CSV export.** PDF: campaign proof report at `/report` (HTML, email-sendable). v1 API exposes usage endpoint.

**First-run flow** 🔴
No first-run checklist surface. A 6-step OnboardingChecklist component (description, issue domains, supporters, verification power, campaign, sent email) existed but was orphaned — zero importers — and has been deleted along with its IssueDomainOnboarding child; the `/api/org/[slug]/issue-domains` endpoints remain live for other consumers. A first-run flow, if wanted, is a fresh build.

**Demo data / sandbox** 🔴
Acquisition pages say "No demo required." No seed data for new orgs. `convex/seed.ts` is dev-only.

**Invite acceptance** ✅
Token-based, time-limited. `/org/invite/[token]/` handles new + existing user. Resend/revoke from settings.

**Empty states** ✅
Dashboard campaigns empty state with "Assemble your first proof" CTA. Most sections degrade gracefully.

**`/org` landing page** ✅
Full acquisition page with specimen packet, capability tiles, research citations (Walker & Le Socius 2023). Title/description plus `og:type`, `og:url`, `og:image`, and Twitter image tags point at `/og/org`.

**Segment pages** ✅
`/org/for/state-legislature`, `/org/for/agency-rulemaking`, `/org/for/local-government` — all live. Menu at `/org/for/`. Each segment page sets `og:type`, `og:url`, `og:image`, and Twitter image tags pointing at `/og/org-for/[segment]`.

**`/about/integrity`** ✅
Full methodology page with GDS/ALD/temporal entropy lookup tables.

**OG images + meta** ✅
Campaign OG images exist at `/og/campaign/[id]` (Satori). Org, segment, and integrity OG endpoints exist at `/og/org`, `/og/org-for/[segment]`, and `/og/integrity`; the corresponding pages now set `og:type`, `og:url`, `og:image`, and Twitter image tags.

**Custom from-line** 🟡
From-name configurable per blast (sanitized, max 64 chars). From-address hardcoded `${org.slug}@commons.email`. No reply-to config.

**Custom domain** 🔴 — Marked gated in plan UI; no DNS verification, no SES identity management.

**SQL mirror** 🔴 — Marked gated in plan UI; no implementation.

**Branding / White-label** 🔴 — Marked gated in plan UI. `org.logoUrl` exists. No theming, no child-org relationship beyond network membership, no per-org CSS.

### 8. Identity + ZK + engagement tiers + contracts

**mDL Android OID4VP** ✅
Production-grade. `FEATURES.MDL_ANDROID_OID4VP=true`. Full chain: HPKE decrypt (ECDH-ES + A256GCM) → CBOR decode DeviceResponse → COSE_Sign1 vs IACA roots → MSO digest → I1 SessionTranscript binding (origin + nonce + JWK thumbprint) → field extraction → privacy boundary → Shadow Atlas geocode. VICAL fallback for unlisted issuers. Code at `src/lib/core/identity/mdl-verification.ts`.

**mDL iOS** 🔵 — `FEATURES.MDL_IOS=false`. ABC enrollment ops dependency.

**mDL Raw `org-iso-mdoc`** 🟡 — `FEATURES.MDL_MDOC=false`. Code in `processMdocResponse` calls shared `verifyMdocDeviceAuth` per I1. **Comment in `features.ts:116` is stale** ("Keep false until T3 lands") — I1 closed T3. Flag is safe to flip but hasn't been.

**Cross-Device Bridge** ✅
API at `src/routes/api/identity/bridge/{start,claim,complete,stream/[sessionId]}`. KV+SSE, HMAC, email-hash anti-phishing, AES-256-GCM (`bridge-crypto.ts`), 3-word pairing code. Both OID4VP lanes share same security floor per I1.

**Passkey verification** 🟠 — `FEATURES.PASSKEY=false`. Full schema fields exist (10+). `passkey-rp-config.ts` + WebAuthn PRF at `src/lib/core/identity/webauthn-prf.ts`. `VerificationGate` does not route to passkey flow.

**Address proof** ✅
Tier 2. Manual address → Shadow Atlas Nominatim → H3 → district. `verifyAddress` mutation sets `trustTier = 2`. W3C VC 2.0 `DistrictResidencyCredential` signed Ed25519 via `district-credential.ts`. 6-month TTL. `FEATURES.ADDRESS_SPECIFICITY='district'`.

**District credential** ✅
`issueDistrictCredential` produces W3C VC 2.0 with Ed25519 signature. Backward-compat HMAC-SHA256 verifier retained.

**Identity Recovery UI** ✅
`IdentityRecoveryFlow.svelte` 4-step flow. `recoverThreeTree` (replace: true). Wired into `VerificationGate` via `showRecovery`. Preserves cellId across retry.

**VerificationGate component** ✅
Graduated routing: Tier-2 → `AddressVerificationFlow`, recovery → `IdentityRecoveryFlow`, Tier-4+ → `IdentityVerificationFlow` (mDL). `clampTier` defense (H-phase). Snapshot-driven auto-dismiss.

**Circuits** ✅
`three_tree_membership` (primary), `district_membership`, `two_tree_membership`, `bubble_membership`, `position_note`, `debate_weight`. Depths: 18/20/22/24.

**Browser-side proving** ✅ — `ThreeTreeNoirProver` WASM singleton. Depth-aware re-init. SA-006 cache-clear. `keccak: true` for Solidity-compatible HonkVerifier output.

**Witness encryption** ✅
X25519 ECDH + BLAKE2b key derivation (frozen domain `voter-protocol-witness-encryption-v1`) + XChaCha20-Poly1305. TEE public key fetch (1h cache, 3 retries). **Active path is `LocalConstituentResolver`** — `NitroEnclaveResolver` is stub.

**Domain strings (frozen)** ✅ — All four confirmed in code.

**Three-tree architecture** ✅
Tree 1 (user identity), Tree 2 (cell-district SMT), Tree 3 (engagement). `UserRootRegistry`, `CellMapRegistry`, `EngagementRootRegistry`. EngagementRootRegistry 180-day max lifetime (SM-4 prevents cherry-picking stale high-tier proofs).

**Server-side verification** 🟡
`district-gate-client.ts` on Scroll **Sepolia** (testnet). DISTRICT_GATE_ADDRESS env-configured. Circuit-breaker (3 failures / 60s, 30s cooldown). EIP-712 relayer signing. Off-chain nullifier dedup in Convex also runs. On-chain verification fire-and-forget async (non-blocking). **No Scroll mainnet deployment.**

**Engagement tier computation** 🟠 (structural gap — see [Tier system gaps](#tier-system-gaps))
Tiers 0-4 defined in circuit. **In practice**, derived from `users.reputationTier` (string) via static `tierMap` in `convex/campaigns.ts:787-790`. `reputationTier` set once at signup. The on-chain engagement tree leaf is circuit-specified but `actionCount` and `diversityScore` not yet computed from on-chain nullifier consumption events.

**On-chain storage** ✅ — `EngagementRootRegistry.sol` 46 Foundry tests. Depth-parametric. 180-day max lifetime.

**Tier portability** ✅ — `identityCommitment` is deterministic; Tree 3 leaf reads same tier for same person across orgs.

**Tier surfacing in verification packet** ✅
`computeTierDistribution` emits TierCount[] with K-anonymity floor. `computeCAI` = (tier3+4)/max(tier1,1). `VerificationPacket.svelte` renders identityBreakdown (trust tiers 0-5) and the engagement tier histogram (0-4) with sub-K bins suppressed as `<5`.

**Tier sync to Convex supporter records** 🟠
`campaignActions.engagementTier` written from `args.engagementTier`. For ZK submissions, publicInputs[30] passed through but no server-side cross-check against `reputationTier`. Client trusted for engagement tier in proof.

**Trust tiers** ✅ (distinct from engagement)

- Tier 0: guest
- Tier 1: email-authenticated (`emailVerified ? 1 : 0`)
- Tier 2: address-attested
- Tier 3: document-verified (mDL `authorityLevel = 3`)
- Tier 4: legacy/passport (no active intake)
- Tier 5: government-credential (`finalizeMdlVerification` sets trustTier=5)

Transitions work via `Math.max(user.trustTier, N)` pattern. H5 cross-check flags inconsistent `cellAnchorMode = 'random-fallback'` with trustTier >= 3.

**Postal Bubble in person flow** 🟡
`Bubble.svelte` + `bubble-state.svelte.ts` + `community-field-contribution.ts`. **No org-embed API endpoint found.**

**Letter send flow** ✅ (gated by `FEATURES.CONGRESSIONAL=false`)
`src/routes/api/submissions/create/+server.ts` checks auth + flag + credential TTL + proof validation + range checks → Convex `submissions.create` (atomic insert + idempotency + nullifier dedup + background delivery + async on-chain anchor).

**Engagement tier read API** 🟡 — Internal Convex query only. No public REST endpoint.

**Identity commitment storage** ✅
PII-free as of 2026-04-10. `users.identityCommitment` indexed. Encrypted PII fields deprecated.

**Nullifier** ✅
H2(identityCommitment, actionDomain) in-circuit. `actionDomain` keccak256 of (templateId + sessionId + districtCommitment + recipientId). Convex `NullifierRegistry` + on-chain `NullifierRegistry.sol`. V2 adds `revocationNullifier = H2(districtCommitment, REVOCATION_DOMAIN)`.

**Specimen rendering of identity method** ✅
`computeIdentityBreakdown` segments trustTier per action: govId (≥3), addressVerified (==2), emailOnly (==1). Rendered in `VerificationPacket.svelte` as stacked bar.

**Identity-method breakdown** ✅ — Four buckets, null rows excluded cleanly.

**Boundary banner** ✅ — H2 `isBoundaryCell` flag in TierDisplay.

**Atlas-version drift surface** ✅ — H6 `atlasDrift` + `atlasDriftLabel` in TierDisplay, unified across AttestationFooter, email footer, /v/[hash].

**Smart contracts** 🟡 (Sepolia testnet only)
`voter-protocol/contracts/src/`:

1. DistrictGate (multi-depth verifier orchestration)
2. DistrictRegistry
3. NullifierRegistry
4. UserRootRegistry
5. CellMapRegistry
6. EngagementRootRegistry (180-day max)
7. RevocationRegistry
8. CampaignRegistry
9. SnapshotAnchor (115 LOC, 17 tests)
10. TimelockGovernance (7/14-day timelocks)
11. VerifierRegistry
12. AIEvaluationRegistry
13. DebateMarket
14. - HonkVerifier\_{18,20,22,24}, DebateWeightVerifier, PositionNoteVerifier

858 `function test` cases. Deployed on Scroll Sepolia. **No mainnet deployment.** `DeployScrollMainnet.s.sol` exists but no broadcast file.

**SnapshotAnchor** ✅
Live `updateSnapshot()` on Sepolia at `0x461173def8c523a9977c87e989471e74e0ca68fe` anchoring `https://atlas.commons.email/v20260512` (per broadcast file). Used for Shadow Atlas content root, not receipt Merkle.

**DebateMarket** ✅ (Sepolia)
~6,550 LOC test files across 4 files (DebateMarket.t.sol, LMSR.t.sol, AIResolution.t.sol, PositionPrivacy.t.sol). Deployed at `0x972ec06229818684796ae3d3f30a29bf1471eae0`.

**Agentic delegation contract** 🔴 — `FEATURES.DELEGATION=false`. No on-chain contract. The Launch pressure / Launch vector **Proof-bound delegated action** row routes to `/studio#capability-composition`, cites Studio reasoning plus recovery as current ground, and keeps the delegation executor, proof attachment, grant-indexed replay, and delegation UI gated, so authored artifacts cannot imply autonomous agent action.

**NitroEnclaveResolver interface stub** 🟡 — `src/lib/server/tee/nitro-resolver.ts` validates HTTPS URL but no enclave deployed. `LocalConstituentResolver` active. The Launch pressure / Launch vector **TEE-attested reasoning** row routes to `/studio#capability-critical-path`, cites local resolver plus signed AI panel ground, and keeps Nitro Enclave attestation, AI panel enclave execution, and position-privacy attestation gated.

### 9. Debate / accountability / legislative monitoring / Phase 3

**DebateMarket contract** ✅ (Sepolia)
LMSR via PRB-math SD59x18 in `LMSRMath.sol`. Commit-reveal trade scheme with ZK debate-weight proofs. Phase 2 position privacy via `IDebateWeightVerifier`/`IPositionNoteVerifier`. AI panel submission via `IAIEvaluationRegistry`.

**Debate propose + campaign debate trigger** ✅ (bounded)
`POST /api/debates/create` Tier 3+, calls `proposeDebate()`. Off-chain ID fallback when blockchain unconfigured. The campaign-linked debate route is no longer a 501: `POST /api/campaigns/[id]/debate` validates editor authority, rate-limits the user, and calls `debates.forceSpawnDebateForCampaign`. Verified action threshold crossing now schedules `internal.debates.atomicSpawnIfEligible` from `campaigns.createCampaignAction`, and the internal mutation re-checks `campaign.debateId` + threshold before inserting so simultaneous threshold-crossers do not duplicate debates. `convex/debates.ts:679:spawnDebate` still enforces Tier 3+ + 5/hr for user-initiated general debate creation.

**SUPPORT / OPPOSE / AMEND stake UI** ✅ (with stake stub)
`createArgument` enforces three-stance union. Components: StanceSelector, SubmitArgumentForm, ArgumentCard. `amendmentText` wired. **`convex/debates.ts:createArgument:461`: "on-chain stake verification not yet wired; cap client-provided stakeAmount for now."** Caps stake at $1 placeholder.

**LMSR pricing display** 🟡
Contract math complete. Off-chain `computeLMSRPercentages` used by 5 components. **`debates` records created with `marketStatus: 'pre_market'`; no path transitions to `active` or populates `currentPrices` — requires Scroll on-chain epoch machinery.**

**AI panel evaluation** ✅
`POST /api/debates/[debateId]/evaluate` imports `@voter-protocol/ai-evaluator`. Calls `loadModelConfigs`, `createProviders`, `evaluateDebate`, `submitAndResolve` (DistrictGate.submitAIEvaluation + resolveDebateWithAI on-chain with EIP-712 multi-model signatures). Cron fan-out via `debates.resolveExpiredDebates` daily 02:00 UTC.

**Resolution + appeals** ✅
`/appeal` calls `appealResolution(debateId)`. `/claim` handles simple nullifier claims + Phase 2 private position settlement. `/governance-resolve` for governance path. Status FSM: active → resolving → resolved | awaiting_governance | under_appeal.

**Debate market on campaigns** 🟡
Schema supports `debateEnabled` + `debateThreshold`. `actionCount` and `verifiedActionCount` are tracked. Verified action threshold crossing schedules `atomicSpawnIfEligible`, and manual editor force-spawn uses the same off-chain action-domain format before linking `campaign.debateId`. **Gaps:** market rows remain `pre_market` until on-chain/mainnet epoch machinery is live, and stake verification still caps client-provided stake at the placeholder path.

**Org-side surfacing of debate signal** 🟡
Campaign page loads debate data (proposition, status, deadline, argument count, `aiPanelConsensus`, `resolutionMethod`, winning stance + argument). Renders AI consensus percentage. **"Top argument body" + "market depth $247" style format not present.** Public campaign page renders `DebateSignal.svelte` when `currentPrices` populated.

**Debate participation in tier** 🔴
No code connects debate stake amounts to trust tier or engagement tier promotion. `engagementTier` on `debateArguments` is read from user's existing trustTier — input to weighted scoring, not output that modifies user tier.

**TEE attestation for AI panel** 🔴 — Not deployed. AI evaluation runs from standard server process.

**Accountability receipts schema** ✅
`accountabilityReceipts` schema: `decisionMakerId`, `orgId`, `billId`, `verifiedCount`, `totalCount`, `proofWeight`, `attestationDigest`, `packetDigest`, `proofDeliveredAt`, `causalityClass`, `alignment`, `anchorCid`, `anchorRoot`, `status`, `responses[]`.

**Receipt writer bridge** 🟡
`campaignDeliveries` now stores `decisionMakerId`, `billId`, `receiptEligibility`, `receiptBlockers`, `packetDigest`, proof weight, and compact packet summary for proof-delivery rows. Campaign targets resolve to active `decisionMakers` by office email when possible. When SES accepts an eligible row, `campaigns.updateDeliveryStatus` inserts a pending `accountabilityReceipts` row with `causalityClass: pending`, `alignment: 0`, `status: pending_response`, and no anchor fields. `legislation.getOrgReceiptSummary` exposes only a bounded recent-row aggregate for OS posture, including `anchorFieldCount` rather than an anchored-receipt claim. This is a bounded source-row writer, not receipt-root/mainnet anchoring.

**SHA-256 attestation generation** ✅
`attestationDigest` + `packetDigest` stored on every receipt. `legislation.ts:2564:hashScorecardSnapshot` for deterministic snapshots.

**Merkle anchoring** 🟡
SnapshotAnchor live on Sepolia. **But anchors Shadow Atlas content root, not accountability receipt Merkle roots.** `anchorCid` + `anchorRoot` fields exist on receipts but no code computes a Merkle tree over receipt batches and anchors it.

**Per-supporter receipt** 🟡
`/verify/receipt/[id]` renders per-delivery receipt via `api.verify.getReceipt`. Schema is org-scoped, not constituent-scoped — a supporter cannot look up their own receipt by identity commitment.

**DM-side receipt verification** ✅ (partial)
`/accountability/[id]` shows attestationDigest. Staffer can manually verify hash offline. **No browser-based crypto verification UI.**

**Receipt UI for org** ✅
`legislation.getDmDetail` returns org-scoped receipts per DM. `getDmFeed` returns cross-DM timeline. `listOrgScorecards` surfaces receipts.

**Receipt API** ✅
`GET /api/dm/[id]/scorecard` (public). `/api/dm/scorecard/compare`. `/api/embed/scorecard/[id]`.

**Scorecard schema** ✅
`scorecardSnapshots` table with responsiveness, alignment, composite, proofWeightTotal, deliveriesSent/Opened/Verified, repliesReceived, alignedVotes, totalScoredVotes, methodologyVersion, snapshotHash. 12-period history.

**Campaign delivery → official response tracking** ✅
`accountabilityReceipts.dmAction` stores legislator vote. `causalityClass` classifies. `recordResponse` writes back.

**Score computation** ✅
`computeScorecards` at `legislation.ts:2532` internal action. 90-day rolling. `responsiveness` = reply / open rate. `alignment` = voted-with fraction weighted by proof weight. `composite` = harmonic. `snapshotHash` for auditability.

**Scorecard publication UI** ✅
`/dm/[id]/scorecard` with AlignmentGauge, ResponsivenessGauge, CompositeScoreBadge, TrendChart, AttestationBlock, TransparencyTable. Org-side via `listOrgScorecards`.

**Org accountability score surface** 🟡
`/org/[slug]/scorecards` consumes `buildAccountabilityResponseReadiness` for its main response rows, then opens with **Scorecard accountability response pressure**: Response ground, Reader signals, and Next response lift cells before the scorecard boundary, CSV export, and score rows. The route-local `WorkspaceCapabilityStrip` maps the shared proof-delivery register, opened-report signal, verification-link signal, reply log, vote-alignment basis, and reader-office workflow rows, while scorecard CSV export remains the local data-sovereignty row. The page server maps the actual `scorecardSnapshots` shape (`composite`, `alignment`, `deliveriesSent`, `deliveriesOpened`, `deliveriesVerified`, `repliesReceived`, `totalScoredVotes`) instead of flattening missing fields to zero: receipt-only rows may cite `receiptCount` for reports sent, while missing opened/verified/replied/vote/score dimensions render as unknown in the dashboard and blank cells in CSV export. The shared route action grammar keeps current reader signal posture separate from stronger response surfaces: bounded or unread response rows read `read response boundary`, while reader-office workflow, notification webhooks, non-federal scorecards, and anchored receipt batches remain dependency-first. The layout-fed `OrgSpacesData.landscape` slice uses the same field mapping plus `scorecardSnapshotCount`, so folded Power terrain, shell Power posture, the Studio Capability map, and the optional canvas map count real score snapshots rather than receipt-only rows. Accountability-response readiness keeps unread response/vote dimensions nullable and treats receipt counts as report evidence, not score evidence. CSV export is live for members through `/api/org/[slug]/scorecards/export?format=csv`. There is no org-level "make public" settings mutation, so the dashboard does not present a public publish button.

**Accountability response OS posture** 🟡
`buildAccountabilityResponseReadiness` lifts aggregate scorecard response evidence into the Studio capability map and shell: proof-delivery receipt counts, opened-report signals, verification-link clicks, logged replies, scored-vote basis, and reader-office workflow boundaries are distinct rows at `#capability-accountability-response`. The layout derives this only from `OrgSpacesData.landscape.scorecardSnapshotCount` plus aggregate `scorecards` fields (`reportsReceived`, `reportsOpened`, `verifyLinksClicked`, `repliesLogged`, `alignedVotes`, `relevantVotes`), so it does not load recipient or office-workflow payload into the shell and does not count receipt-only rows as score snapshots. This is posture only: opened/clicked/replied signals are accountable response evidence, not an office-response workflow, notification workflow, non-federal scorecard surface, or anchored receipt batch.

**Cross-jurisdiction scorecards** 🟡
`jurisdictionLevel` supports federal/state/local/international. Score computation is DM-agnostic. **Bill data is US federal only** (Congress.gov, `jurisdiction: 'us-federal'`). No OpenStates / state-legislature integration. State/local scorecards would have `totalScoredVotes = 0`.

**Agentic bill monitoring** 🟠
`syncPipeline` fetches Congress.gov every 6h, upserts bills, scores relevance against org issue domains, creates `legislativeAlerts` for orgs. **No constituent-level alert subscription**, no Shadow Atlas integration for bill-to-district matching, no agentic monitoring across constituent's districts, no push notification to supporters. Monitoring is org-scoped, not constituent-scoped.

**Bill search** 🟡
US 119th Congress only. Full-text via Convex `searchBills`. Relevance via Gemini text-embedding-004 + cosine. **No OpenStates, no LegiScan, no state bill corpus.**

**Per-supporter bill alerts** 🔴
Not implemented. `legislativeAlerts` is org-scoped. No constituent-level subscription table.

**Org-side bill-tracking surface** ✅
`listAlerts`, `listWatchedBills`, `listRelevantBills`, `browseBills`, `watchBill`, etc. all implemented. Campaign creation can prefill from alert via `getAlertWithBill`.

**Org Bills terrain surface** 🟡
`/org/[slug]/legislation` exposes a `WorkspaceCapabilityStrip` that consumes `buildLegislativeMonitoringReadiness`: the route passes route-local search-result counts from `GET /api/org/[slug]/bills/search`, watched bills from `legislation.listWatchedBills`, relevant rows from `legislation.listRelevantBills`, and positioned counts from `orgBillWatches.position`. The route anchors the live work at `#bill-search`, `#bill-watchlist`, and `#bill-relevance`, then states the stronger-claim boundary at `#bill-terrain-boundary`. That boundary renders held rows from the shared readiness contract (`state-local-corpus`, `per-supporter-alerts`, `delegated-monitoring`, and `multi-jurisdiction-routing`) with state-aware action labels, gate names, and row boundaries, rather than local null counts or raw task-id cells. The same builder lifts federal corpus, org watchlist, org relevance, positions, state/local corpus, per-supporter alerts, delegated monitoring, and multi-jurisdiction routing into the OS map, Bills terrain route, Spotlight, operator queue, and claim basis. Search, watch/unwatch, relevance review, and position-setting use the existing org-scoped bill APIs; state/local bill ingestion, special-district bill coverage, per-supporter alert fan-out, delegated agent monitoring, and decisionMaker/bill/scorecard joins remain dependency-first.

**Intelligence loop** ✅
`convex/intelligence.ts`: queryItems, getRecent, store, markExpired, ingest (Gemini embedding). DM follow/unfollow, activity timeline, org discovery, bill watch/relevance scoring. **Constituent-level agentic monitoring absent.**

**Multi-country coalition campaigns** 🟡
`targetCountry` is single string field. `targetJurisdiction` is single optional string. **No multi-country array, no coalition aggregation across countries.** NETWORKS works for same-country org coalitions only.

**Per-country verification** 🟡
`importRepresentatives` supports `jurisdictionLevel: 'international'`. ZK proof chain supports multi-depth trees. **CA/GB/AU resolvers stubbed.** No per-country district tree in Shadow Atlas for non-US.

**Coalition aggregation** 🟡
Network stats provide country buckets from supporter records plus aggregate supporter/action proof metrics across active member orgs. The network detail page loads `api.networks.getStats` server-side before rendering coalition proof posture, so it no longer presents zero placeholder hero numbers; it also loads `api.networks.getProofPressure` for capped receipt-backed decision-maker pressure rows instead of an empty pressure placeholder. The detail `WorkspaceCapabilityStrip` maps shared `buildCoalitionReadiness` rows to local proof, member, routing, and artifact anchors, then inserts the proof-pressure row as route-specific receipt evidence. Durable coalition artifacts remain boundary rows until reader-office response terrain, cross-border routing, and mainnet anchoring are armed. The held actions name those separate contracts as `read proof-pressure boundary`, `Cross-border routing boundary`, and `Coalition artifact boundary`. Receipt/action country breakdown, multi-country campaign targeting, and explicit "4,200 verified constituents across 3 countries" proof copy remain absent.

**Delegation contract** 🔴 — `FEATURES.DELEGATION=false`. No Solidity contract.

**Agent acts on constituent's behalf** 🟡
`convex/delegation.ts` complete: createGrant, updateGrant, revokeGrant, recordAction, submitReview, insertGrant, patchGrant. Scopes: campaign_sign / debate_position / message_generate / full. Daily action limits, review queue. **No automation engine calls `delegation.recordAction`.** Data-model-complete, no executor.

**Agent UI** 🟠 — No delegation UI components or routes exist.

**Stance positions** ✅
`convex/positions.ts` + `positionRegistrations` table (identity-commitment-keyed with nullifier dedup). Routes: `/api/positions/{register, confirm-send, batch-register, count/[templateId], engagement-by-district/[templateId]}`. `FEATURES.STANCE_POSITIONS=true`. Independent of DEBATE — template-level binary choices.

**Analytics expanded** ✅
`src/lib/server/campaign-analytics.ts` powers delivery metrics, timeline buckets, geographic spread, verification counts. `FEATURES.ANALYTICS_EXPANDED=true`. Components: DeliveryMetrics, VerificationTimeline, GeographicSpread.

**Engagement metrics flag = false** — gates public-facing "X people acted on this" counts and per-email engagement on org landing, blast pages, network reports, campaign supporter counts, public template page counter, profile page. Deliberate launch decision.

**DEBATE reveal endpoint** ✅ (E0 fixed 2026-04-23)
`POST /api/debates/[debateId]/reveal` live with full validation: epoch, commitIndex, argumentIndex, direction (0/1), nonce, debateWeightProof, debateWeightPublicInputs (exactly 2). `allowChainMisconfig` import present.

## Critical stub inventory

For quick reference. Each is a searchable file:line where the code intentionally short-circuits.

| #   | Capability                                    | Status                               | Evidence                                                                                                                                                                      |
| --- | --------------------------------------------- | ------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Direct platform sync foundation           | 🟡 Credential custody + dependency-bound credential-custody boundary | `src/routes/org/[slug]/supporters/import/platform-api/+page.server.ts` stores encrypted selected-platform credentials when custody key exists; sync still returns the platform sync boundary |
| 2   | Direct vendor direct sync boundaries beyond CSV profiles | 🔴 Not implemented                   | CSV export profiles are live in `src/routes/org/[slug]/supporters/import/+page.svelte`; no EveryAction/NGP VAN, NationBuilder, or Mailchimp API routes exist                  |
| 3   | Text carrier dispatch                         | 🟡 Bounded carrier dispatch path + counted composer audience handoff | `src/routes/api/org/[slug]/sms/[id]/+server.ts` can send client-decrypted E.164 recipient batches through Twilio and record receipts through `sms.recordDispatchBatch`; the route reloads `sms.getEncryptedRecipientsForBlast` before carrier send to reject IDs outside the next saved-audience batch, the composer saves counted tag/segment audience filters into the draft, and the detail route can prepare 100-recipient encrypted-phone batches in-browser until the saved eligible cohort is recorded |
| 4   | A/B automated dispatch                        | 🟡 Exact runner hooks + dispatch gate | `convex/email.ts:pickAbWinners` marks winners; `createAbRemainderDraft`, `enqueueAbTestDispatch`, and `enqueueAbRemainderDispatch` preserve exact hash snapshots, but production side effects remain preserved drafts until server-dispatch runtime evidence clears; tracked as `T1-6b` |
| 5   | Workflow public arming + email dependencies   | 🟡 Bounded runner live; email dependency-bound | `convex/workflows.ts` arms trigger dispatch, tag writes/removals, branch conditions, delay/resume, and run logs for non-email workflows; workflow detail run logs surface `partial_no_op` rows as unsupported-step boundary evidence, not clean coordination completion; `src/routes/api/org/[slug]/workflows/[id]/+server.ts` returns `workflow_email_dependency_missing` for email-bearing definitions until SES/from-email/org-key-verifier runtime is configured |
| 6   | Workflow trigger dispatchers                  | 🟡 Bounded runner live               | People, campaign/action, event RSVP/check-in, and donation trigger events create executions only for enabled workflows; non-email side effects can now run through the bounded runner |
| 7   | Donation confirmation register                | 🟡 Baseline/config-dependent         | `convex/webhooks.ts:completeDonation` + `convex/donations.ts:confirmationEmailStatus`                                                                                         |
| 8   | ses-proxy Lambda                              | 🔴 Not deployed                      | `PUBLIC_SES_PROXY_URL` empty in prod                                                                                                                                          |
| 9   | On-chain stake verification (debates)         | 🟠 Cap at $1                         | `convex/debates.ts:createArgument:461`                                                                                                                                        |
| 10  | Congressional delivery                        | 🟠 Env-gated                         | `GCP_PROXY_URL` + `CWC_API_BASE_URL` unset                                                                                                                                    |
| 11  | CA/GB/AU rep-lookup                           | 🟠 Fails closed                      | `LIVE_RESOLVER_COUNTRIES = ['US']`; `lookupRepresentatives()` throws `REP_LOOKUP_NOT_CONFIGURED` instead of returning hollow `[]` success                                    |
| 12  | Per-supporter bill alerts                     | 🔴 Missing                           | `legislativeAlerts` is org-scoped                                                                                                                                             |
| 13  | Reader-office webhook notifier                | 🟠 Gated                             | T8-8 reader-side notification path                                                                                                                                            |
| 14  | Human-readable district segment labels        | 🟡 Imported/action-time congressional labels + hash evidence | `stateCode` can target imported state/province codes, `congressionalDistrict` can target imported readable district labels, `actionDistrictLabel` can target action-time readable congressional district labels, and `actionDistrict` can target action `districtHash`; verified/materialized local/special district labels remain tracked as `T1-8c` |
| 16  | AI panel TEE attestation                      | 🔴 Not deployed                      | LocalConstituentResolver active                                                                                                                                               |

## Cross-cutting missing capabilities

Organized by surface for completeness — see per-domain sections above for individual entries.

### Org foundation

- No org delete, no slug rename, no `customDomain`/`fromEmail`/`replyTo` fields at org level
- No explicit transfer-owner ceremony or org-level audit log
- Custom fields are opaque blob (no schema, no type system, no UI for definitions)
- No verified/materialized local/special district segmentation beyond imported state/province, imported/action-time congressional district labels, postal-code, country, campaign participation, and action-district hashes
- No free-text search (hash-based only)
- No double opt-in / consent fields
- No re-engagement triggers / sunset policies / cross-org dedup
- No audit log

### Campaign

- No `PETITION` campaign type
- No scheduled activation
- No audience segment filter on campaigns
- No sender identity per campaign
- No coordination integrity time series
- No atlas version per campaign action
- No CSV/PDF export of supporters or analytics
- No per-supporter engagement history

### Email

- No email blast template library
- Convex plaintext multipart is implemented; client-direct delivery still waits on proxy deployment confidence
- Reacher SMTP probing still unwired; soft-bounce categorization and consensus manual bounce suppression are live
- No send-time optimization
- No domain warmup / engagement-based throttle
- Convex List-Unsubscribe headers wired, but production dispatch and T2-4b provider rendering still unverified
- Click tracking attribution is heuristic
- No pre-send checklist / admin sign-off gate

### Power Landscape + decision-makers

- Only federal officeholder data ingested
- The folded Power workspace (`LandscapeSpace`) and `/org/[slug]/representatives` both expose Power terrain through `buildPowerTerrainReadiness`. The folded workspace passes layout-loaded follows, watched bills, and score snapshots, leaves discoverable-official count null because discovery is route-local, and renders a compact terrain coverage readout from the shared summary. `/org/[slug]/representatives` passes route-local discover counts from `legislation.discoverDms`, keeps followed targets cited against `legislation.listOrgDmFollows`, and mirrors the shared Power rows for bills corpus, score snapshots, state/local/special-district terrain, international resolver wiring, reader-office response surfaces, and decision-maker/bill/scorecard joins. The target detail route maps its strip from `buildPowerTargetDetailRows`, keeping contact evidence and office workflow separate: absent public contact ground reads `read contact boundary`, while unarmed reader-office notification workflow reads `read office-workflow boundary`. Follow/discover records are usable target ground; wider terrain, office response, and joined-plane claims remain explicitly bounded.
- 24 boundary types defined; only slot 0 populated
- No Cicero/BallotReady/OpenStates integration
- No interactive postal-bubble disambiguation UX (spec is aspirational)
- `cwc_code` always null in officials file
- No multi-jurisdiction routing at campaign layer
- No predictive dialer / phone banking
- No click-to-call widget

### SMS / events / fundraising

- No MMS support
- No A2P 10DLC brand registration
- Bounded SMS reply register live; no admin reply queue
- Event route strips consume `buildEventReadiness`: saved event record, public RSVP intake, waitlist roster storage, code-bound attendance, and ICS/non-PII CSV artifacts share one gate-backed contract. Event index/builder/detail now start with Event operating pressure cells for Record ground, RSVP intake, and Next event lift, derived from the same readiness rows before list counters, publication controls, event form fields, event metrics, check-in code, roster, or export controls appear.
- No event map (lat/lng present)
- No calendar provider integration
- No QR code rendering
- No decrypted attendee export
- No waitlist auto-promotion
- No recurring donation cancel UI in org dashboard
- No ActBlue integration
- No subscriber roster for recurring donors

### API + developer

- SDKs unpublished (npm + PyPI)
- Outbound org webhooks are live; no reader-office webhook notification workflow yet
- No `/api/v2/` versioning policy
- No OSDI compliance
- No audit log API
- v1 activity feed and org event SSE exist, but developer onboarding examples and receiver/consumer UX remain thin
- "No rate cap" claim contradicted by 100 req/min free tier
- No "Building on Commons" developer portal
- Embed widget shallow (no postal-bubble, no ZKP, no per-embed analytics)

### Billing + dashboard

- No invoice history UI
- SMS quota is surfaced on settings; bulk SMS dispatch has a bounded carrier dispatch path, counted composer audience handoff, and draft-detail browser cohort sender, while broad carrier delivery remains gated
- No grace period countdown banner
- No metered overage billing (accepted residual)
- No demo data / sandbox

### Identity + tier + contracts

- `reputationTier` has no writer post-signup
- `engagementTier` on actions is client-trusted in non-ZK submissions
- CAI metric reads the string map, not on-chain engagement
- Contracts on Scroll Sepolia testnet only
- TEE not deployed
- MDL_MDOC flag comment stale post-I1

### Phase 3

- Custom domain, SQL mirror, white-label not built
- Shared supporter pools across orgs not built
- Cross-org reputation portability not built
- Cross-border coalition aggregation absent
- Delegation execution engine missing
- Receipt Merkle anchoring pipeline not built

## Severity-ranked gap rollup

### P0 — Breaks first-impression demo (sales blocker)

1. Donation receipt posture is partial: `buildFundraisingReadiness` now lifts no-PII fundraiser/donation aggregates, baseline confirmation outcomes, provider-accepted send identifiers, receipt-policy text, shared `rows`, and `proofRows` receipt boundaries into the OS map and route-local fundraising strips / `#fundraising-receipt-proof-contract`, but legal/tax acknowledgment proof, mailbox delivery proof, and anchored receipt proof are absent

Closed since the original audit: the org home packet is no longer hardcoded `null`, the first-read funnel/tier data now comes through the layout-fed Results and People slices instead of dashboard-local fabricated zeros, supported email merge fields resolve on Convex batch sends plus browser-direct singleton personalized sends, and org/segment/integrity pages now emit OG image/meta tags.

### P1 — Blocks incumbent-platform migration (direct API motion)

6. Direct platform import remains gated at the direct sync boundary; platform CSV export profiles are live, encrypted credential custody is bounded/storable when the server key is configured, and the platform boundary can now probe the stored credential envelope without calling a vendor API
7. Direct EveryAction/NGP VAN, NationBuilder, and Mailchimp API syncs are absent; CSV exports are recognized and preserved
8. Verified/materialized local/special district segmentation beyond postal/country/state-code/imported-congressional/action-time-congressional/action-district evidence is absent
9. Saved People segments can now use imported state/province code, imported congressional district labels, action-time congressional district labels, campaign participation, action-district hash, and max action engagement tier; full local/special district labels remain absent
10. Custom fields are opaque blobs
11. No email template library
12. No double opt-in / consent fields
13. No explicit transfer-owner ceremony or org-level audit log

Closed since the original audit: campaign clone ships through `campaigns.clone` and the campaign list duplicate action; postal-code, country, campaign-participation, action-district hash, action-time district-label, and engagement-tier segment cases now evaluate in the shared segment matcher; saved People segments can now be selected as email recipient lists and enforced at recipient-load.
T5-1 auto-debate-spawn is also closed: verified action threshold crossing schedules `atomicSpawnIfEligible`, and the manual campaign debate route calls `forceSpawnDebateForCampaign` instead of returning a 501.

### P2 — Blocks Phase 2 product claims

15. Text carrier dispatch has a bounded carrier dispatch path, counted composer audience handoff, draft-detail browser cohort sender, and bounded reply register; broad one-click carrier dispatch is still gated
16. A/B cohort snapshot, remainder draft, and exact queue hooks exist, but production test/remainder dispatch is held by the server-dispatch gate
17. Workflow trigger dispatchers and non-email side effects are armed through the bounded runner; workflow email remains dependency-bound
18. Coalition aggregate stats are live through the network stats route; cross-org sharing, cross-border rollup, and large-coalition snapshot paths remain bounded
19. ses-proxy Lambda not deployed
20. Congressional delivery env-gated
21. CA/GB/AU rep-lookup fails closed until country data is hydrated
22. Custom domain + SQL mirror + white-label marked gated in settings plan comparison but not built

### P3 — Blocks Phase 3 differentiation

23. On-chain stake verification stubbed (Convex caps debate stake at $1)
24. Per-supporter bill alerts missing
25. Delegation has data model + Convex CRUD but no execution engine, no UI
26. Cross-border coalition campaigns lack multi-country scope
27. Contracts on Sepolia testnet only
28. TEE not deployed

### P4 — Structural honesty risks

30. `reputationTier` never updates after signup
31. `engagementTier` client-trusted in non-ZK submissions
32. CAI measures the string map, not actual engagement
33. 24 boundary types defined; only slot 0 ingested
34. Trialing Stripe status treats orgs as free-tier
35. MDL_MDOC flag comment stale post-I1

### P5 — Developer platform gaps

36. SDKs unpublished
37. Outbound org webhooks live; reader-office notifications still gated
38. "No rate cap" claim contradicted
39. No OSDI compliance in v1 API
40. No audit log API; v1 activity feed and event SSE are present but need developer-facing receiver examples and consumer UX
41. Embed widget shallow

## Top launch blockers (ordered)

| Order | Gap                                        | Why first                                                                                                                                           | Effort estimate                                                             |
| ----- | ------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------- |
| 1     | Direct platform sync foundation               | Direct platform import remains gated; platform CSV export intake is live, and encrypted credential custody is now a bounded stored state when the server key is configured | First direct sync execution path, then per-platform proof |
| 2     | Text carrier dispatch                      | Twilio dispatch runner can send supplied browser-decrypted batches; the draft detail route can prepare the saved eligible cohort in 100-recipient browser-decrypted requests | Composer audience selection                     |
| 3     | Donation receipt compliance posture        | Provider-accepted confirmation message ids and receipt-policy text can render in baseline confirmations; legal/tax acknowledgment proof, mailbox delivery proof, and anchored receipt proof remain absent | Receipt template/legal policy workflow + anchoring                          |
| 4     | A/B automated test/remainder dispatch      | Cohort snapshot, exact remainder draft, and exact queue hooks exist; production side effects remain preserved drafts until server-dispatch runtime evidence clears                         | `T1-6b`: arm A/B runner behind production server dispatch                   |
| 5     | Human-readable district-label segmentation | `buildPeopleSegmentationReadiness` now exposes saved segment posture, source/proof/action-context filters, imported state-code, imported congressional-district, and action-time district-label filters, plus the civic-label boundary; full civic geography still needs verified/materialized local and special district labels | `T1-8c`: denormalize local/special district labels or preload enriched context      |
| 6     | Workflow email dependency confidence       | `buildCoordinationReadiness` now lifts workflow definitions, trigger families, bounded non-email execution, and run evidence into the OS map; workflow pages also render current `workflowEmailReadiness` so email-step count, missing SES/org-key/from dependencies, and per-run checks are visible before enablement, while `partial_no_op` runs stay visible as unsupported-step boundary evidence instead of clean completion | Verify SES/org-key workflow email path in production, keep email-bearing arming dependency-checked, and retire legacy unsupported step rows |
| 7     | Server-side email dispatch                 | Large/no-key sends still become delivery drafts                                                                                                     | Arm server/TEE dispatch path after SES and key custody gates                |
| 8     | Consent-bound reach completion             | `buildEmailListHealthReadiness` now exposes subscribed reach, imported consent evidence custody, suppression, unsubscribe status, bounce/complaint attribution, verified report consensus suppression, and a wired Convex one-click header substrate from aggregate People counts and gate evidence, but production dispatch, T2-4b provider rendering, legal-policy workflows, and per-org sender-domain authentication remain gated | `T2-4b` provider-rendering verification + `T2-6` custom domain/DKIM  |
| 9     | Reader-office notifications                | Signed event substrate and webhook delivery attempts are external-system ground; Commons-owned office alert loops remain separate from Results/Power until office profiles, office-response workflow, and notification consumers land | `T8-1a`/`T8-1b` office profiles + `T8-8` notification consumers |
| 10    | Durable proof settlement                   | Verification packets, bounded receipt/source rows, reader verifier, and Sepolia/testnet registry posture are visible; receipt roots, durable archive proof, public-chain permanence, and mainnet DistrictRegistry/DebateMarket/SnapshotAnchor remain gated | `T3-6` + `T5-5` + `T6-2` mainnet deployment, then `T6-1` receipt Merkle roots |
| 11    | TEE-attested reasoning                     | Local constituent resolution, debate AI panel signatures, and quality-trigger plumbing are visible; TEE-attested constituent resolution, AI panel execution, and position-privacy attestation remain gated | `T5-3` Nitro Enclave deployment, then `T5-4` AI panel execution and `T5-7` attestation chain |
| 12    | Proof-bound delegated action               | Studio can ground, author, recover, and hand off operator-initiated artifacts; autonomous civic action, ZK proof attachment, grant-indexed replay, and delegation UI remain gated by the executor and attestation path | `T4-2` proof-bound drafted messages, then `T4-1` executor plus `T4-8`/`T4-9` trace/UI |

Closing these moves the org product from "looks finished, partially is" to "actually launchable to first paying orgs."

Closed since the prior launch-blocker list: campaign clone, postal-code/country/action-context segment matching, soft-bounce suppression verification, verified manual bounce-report consensus suppression, and org/segment/integrity OG image/meta surfaces.

## Strategic implications

**The verification packet itself works end-to-end.** GDS, ALD, temporal entropy, burst velocity, CAI all computed and rendered. Coordination integrity, campaign reports, attestation hashes, SES delivery tracking — load-bearing flows are real. mDL Android OID4VP is production. Three-tree ZK circuit is production. 858 contract tests pass on Sepolia. The advocacy substrate is there. Platform migration is now split honestly: export-file intake can recognize common incumbent formats today, while direct API migration remains gated.

**The gap is execution of the surrounding surface.** Areas where the product looks finished but isn't:

1. **The direct platform migration story** — platform CSV export intake is real and the platform-neutral route can prove encrypted credential custody, but per-platform direct sync execution paths for OSDI-compatible or vendor-specific formats do not exist.
2. **The first-read demo is improved but not fully safe** — packet/funnel/tier fakery, direct merge personalization, 10DLC readiness, and public-grid claims about sequences, event proof funnels, compliance reporting, campaign-trigger automation, and proof-bearing workflow automation are closed or bounded in active copy. Partial donation receipts and unarmed channel verbs can still break trust quickly if future surfaces drift from shared readiness contracts.
3. **Phase 2 features marketed as complete** — SMS dispatch has a bounded carrier dispatch path, counted composer audience handoff, and draft-detail browser cohort sender, but broad carrier delivery still waits on the SMS dispatch gate, carrier evidence, and route-local dispatch checks; workflow email dependency confidence and A/B production dispatch also remain held. The OS now surfaces text delivery as aggregate posture plus bounded carrier-dispatch substrate, not as broadly armed carrier execution; workflow non-email side effects are bounded, not proof-bearing automation. Coalition aggregate stats are live through the network stats route, but cross-org sharing, cross-border rollup, and durable coalition artifacts remain bounded. Built != fully armed.
4. **Honesty of the tier system** — `reputationTier` set-once at signup, `engagementTier` client-trusted off the ZK path, CAI measuring the string map. Metric shown to decision-makers depends on substrate that doesn't update over time and isn't independently cross-checked.
5. **Pricing-tier features still unbuilt** — custom domain (Org+), SQL mirror (Org+), white-label (Coalition) are now marked gated in settings, but the implementation still does not exist.

**Honest claim:** "Phase 2 features were built and the schema/UI are present, but several have stubbed execution paths that need closing before launch." The 2026-03-13 milestone was a development milestone, not a functional completion milestone.

## Honest unknowns

Data not surfaceable from this scope (would require additional verification):

- **Per-feature usage/adoption inside Commons** — no analytics instrumentation queries available; can't say which features are used
- **Real-world deliverability rate from SES** — depends on operator config (Configuration Set, SNS destinations, DKIM record state) not enforced in code
- **Whether the `congress-legislators` data source is being updated on schedule** — needs operator confirmation
- **Whether Reacher fly.toml is actually deployed** — config present, no code calls it
- **Effective Twilio account state** — env vars set but Twilio account status not verifiable from code
- **State of Stripe webhook subscription** — webhook handler exists; whether it's registered with the correct Stripe endpoint is operator config

---

_Source: 9-agent code inspection 2026-05-27. Cross-references: `docs/strategy/product-roadmap.md`, `docs/implementation-status.md`, MEMORY.md, `docs/research/competitive-analysis.md` for what competitors offer at each surface._
