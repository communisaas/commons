# Org Capability Scope — May 2026

> **Date:** 2026-05-27
> **Method:** 9 parallel agent-driven code inspection passes across the full org surface
> **Source of truth:** Convex backend + SvelteKit routes + voter-protocol contracts (pre-commit state on `main`)
> **Status legend:** ✅ Shipped (production) | 🟡 Partial (works, gaps noted) | 🟠 Stubbed (schema/UI exists, impl missing) | 🔵 Architecture-ready, not user-facing | 🔴 Missing entirely

## Purpose

This doc is a point-in-time, code-grounded inventory of the org-layer capability surface. It exists because (a) `docs/implementation-status.md` and `docs/strategy/product-roadmap.md` claim "Phase 0-2 COMPLETE" while several Phase 2 features have stubbed execution paths, and (b) `src/routes/org/[slug]/settings/+page.svelte:170` lists pricing-tier features that have no implementation. The intent is to align what we say is shipped with what code actually does, and to make the closure path explicit.

A 9-agent inspection pass on 2026-05-27 walked the codebase looking at file paths, function bodies, schema fields, feature flags, and recent memory entries. Each agent classified every capability in its lane as ✅/🟡/🟠/🔵/🔴 with file:line citations. This document is the consolidated output.

## Headline findings

The org layer is **substantially built** (~7,700 LOC org-side, plus the foundation in voter-protocol). The verification substrate works end-to-end: GDS, ALD, temporal entropy, burst velocity, and CAI are computed and rendered; coordination integrity surfaces correctly; campaign reports render with cryptographic attestation hashes; SES delivery tracking with sesMessageId correlation works; mDL Android OID4VP is production-grade including HPKE decrypt, COSE_Sign1 against IACA roots, and I1 SessionTranscript binding; the three-tree ZK circuit runs in browser WASM; 858 Foundry tests pass on Scroll Sepolia; SnapshotAnchor has a live `updateSnapshot()` transaction anchoring atlas v20260512.

The capability surface has **23 explicit stubs** — HTTP 501 returns, `STEP_TYPE_NOT_IMPLEMENTED` logs, or hardcoded zeros with `// TODO` comments. These are not abstract gaps; they are searchable file:line locations where the code intentionally short-circuits.

The capability surface has **~30 additional partial gaps** — features where schema and UI exist but functionality is incomplete (e.g., bulk email merge fields ship as literal `{{firstName}}`; donation receipts UI promises delivery but no send fires; engagement tier histogram is computed in every packet but never rendered in the UI).

Several pricing-tier features (custom domain, SQL mirror, white-label, cross-org coalition aggregation) appear in the settings comparison grid but have no implementation. The sales surface is making claims the code does not back.

The org product is in the **dangerous middle state**: the surface looks finished, but a real user hitting the workflow encounters a 501, a no-op, or an empty result. Closing the top ~10 stubs is the difference between "Phase 0-2 marketing claim" and "actually launchable to first paying orgs."

## Capability surface by domain

### 1. Org foundation + supporter management

**Org CRUD + multi-tenancy** 🟡
Create/update via `convex/organizations.ts:522,313`. Schema at `convex/schema.ts:1362`. Slug uniqueness via `by_slug` index. Defaults: `countryCode: "US"`, `maxSeats: 2`, `isPublic: false`. **Gaps:** no org delete mutation; no slug rename (update excludes slug); no `customDomain`/`fromEmail`/`replyTo` fields at org level (only on `emailBlasts` rows); no branding theme.

**RBAC** 🟡
Three roles (owner/editor/member) hierarchy enforced in `convex/_authHelpers.ts:requireOrgRole`. Invite system at `convex/invites.ts` with HMAC-hashed tokens, 72-hour expiry, seat-limit check at invite creation (`invites.ts:488`). Cross-org membership: `getMyMemberships` returns all orgs for a user; `by_userId_orgId` index. **Gaps:** no member removal mutation (no `ctx.db.delete` on `orgMemberships` anywhere); no `updateMemberRole`; no transfer-owner flow.

**Supporter management** ✅
Paginated list with cursor at `convex/supporters.ts:36` (max 100/page, scans up to 10K). Filters: emailStatus, verified, source, tagId. Tags: flat, org-scoped, auto-create on import (`ensureTags`). Custom fields: single encrypted JSON blob (`encryptedCustomFields`). Fields stored: email (encrypted), name (encrypted), phone (encrypted), postalCode, country, emailStatus, smsStatus, verified, identityCommitment, source. Summary stats at `supporters.ts:260`. **Gaps:** no district membership denormalized on supporter rows; engagementTier segment filter is no-op; no free-text search (hash-based only); custom fields are opaque (no type system).

**CSV import** ✅
3-step wizard at `src/routes/org/[slug]/supporters/import/+page.svelte`. Client-side RFC 4180 parse with BOM stripping. Auto-mapping: 20+ header aliases plus AN export detection. Manual column mapping UI. Org-scoped email-hash dedup. Per-row error collection. Batch tag auto-create via `ensureTags`. Max 10 MB file, 5,000 supporters per server action call, 100 rows/batch. Encrypted single-phase insert via `importWithEncryption` action. **Gaps:** no custom field column mapping; no partial-resume for files >5,000 rows.

**Action Network OSDI sync** 🟠 (HTTP 501)
Schema for sync state exists (`organizations.anSync` embedded object: status, syncType, totalResources, processedResources, currentResource, imported, updated, skipped, errors). UI at `src/routes/org/[slug]/supporters/import/action-network/+page.svelte` polls every 3s. **The `connect` server action at `+page.server.ts:54` returns `fail(501, 'Action Network connection requires a public encrypted API-key contract')`.** No actual OSDI HTTP calls anywhere. `startAnSync` sets status to 'running' but no background job fires. The migration story — the named GTM motion — is a UI mirage.

**Other CRM imports** 🔴
EveryAction + NationBuilder tiles at `src/routes/.../import/+page.svelte:707-735` are disabled `<div>` "coming soon" placeholders. Marketing copy on `/org/for/local-government` claims "Import from Action Network, EveryAction, NationBuilder, or any CSV export" — only CSV actually works.

**Segmentation UI** ✅
Filter builder in `src/lib/types/segment.ts` + `convex/segments.ts:64:matchCondition`. 7 field types: `tag` (includes/excludes), `verification` (equals), `engagementTier` (no-op pass-through with explicit `// Intentional fail-OPEN` comment at `segments.ts:99-106`), `source`, `emailStatus`, `dateRange`, `campaignParticipation` (defined in types but absent from `matchCondition` switch). AND/OR at filter level. Saved segments per org. Bulk apply/remove tag, paginated to ~51K supporters. Encrypted + decrypted CSV export. **Gaps:** no geographic/district filter (no `postalCode`/`state`/`country` case); `campaignParticipation` filter is dead code; `engagementTier` is labeled fail-OPEN; recipientFilter for email blasts supports only `tagIds` + `verified` — cannot use saved segments as a recipient list directly.

**Subscription state** ✅
`emailStatus`: subscribed/unsubscribed/bounced/complained. HMAC-signed unsubscribe tokens with dual-secret rotation (`UNSUBSCRIBE_SECRET`). SES bounce/complaint webhooks update cross-org via globalEmailHash. Complaints always win — cannot be downgraded. SMS STOP keyword → `smsStatus: stopped`, manual override blocked. START re-engagement wired via Twilio webhook. Stranded placeholder cleanup cron (15-min threshold). **Gaps:** no double opt-in flow; no CAN-SPAM/CASL consent fields (`consentedAt`/`consentSource`/`consentText`); unclear whether SES sends with List-Unsubscribe headers on Convex server-side path (Lambda path includes them).

**List hygiene** 🟡
Cross-org bounce propagation. `suppressedEmails` table with domain-level + per-email suppression. `bounceReports` table. Reacher SMTP probe cron entry (not wired — the `processBounceReports` cron returns `{ processed: 0 }`). Complaint-wins logic. **Gaps:** no re-engagement triggers; no sunset policies; no cross-org dedup for imports (only for bounces/complaints).

**Custom domain + DKIM/DMARC** 🔴
No code. Schema has no `customDomain`/`dkimKey`/`dkimSelector`. From-email hardcoded `${org.slug}@commons.email`. Listed as Organization+ tier feature in pricing UI (see [Pricing UI gaps](#pricing-ui-gaps)) without implementation.

**Audit log** 🔴
No org-layer audit log. `verificationAudits` is user-identity scoped. `agentTraces` is per-request. No table records who-did-what-when at the org level.

### 2. Campaign engine + verification packet

**Campaign CRUD** ✅
Create at `convex/campaigns.ts:322`. Update at line 407 covers title, type, body, status, templateId, debateEnabled/Threshold, targetCountry, targetJurisdiction, position. Status FSM at line 599: `DRAFT → ACTIVE`, `ACTIVE → PAUSED | COMPLETE`, `PAUSED → ACTIVE | COMPLETE`. Delete at line 474 cascades to `campaignActions` and `campaignDeliveries`. Target management at lines 642/698 (max 50 targets/campaign, email dedup). `getStatusCounts` at line 287. Campaign types in schema: `LETTER`, `EVENT`, `FORM`, `FUNDRAISER`. **Gaps:** no `PETITION` type; no clone/duplicate function (top friction for recurring campaigns); no scheduled activation (`scheduledAt` doesn't exist on campaigns); no audience segment targeting on campaign; no per-campaign sender identity (from-email is env var only — `dispatchReportEmails` at line 1607 hardcodes it).

**Campaign actions** ✅
Schema at `convex/schema.ts:1702`: `campaignId`, `orgId` (denorm for billing), `supporterId`, `verified`, `engagementTier`, `districtHash`, `h3Cell`, `messageHash`, `trustTier`, `compositionMode`, `delegated`, `delegationGrantId`, `sentAt`. Action creation at `campaigns.ts:896` with `by_campaignId_supporterId` dedup. Submission flow at line 992 (PII encryption, dedup, district hash, K-floor on returned count). **Note:** for new actions, `trustTier` is correctly snapshotted at submission time (frozen on the row). The legacy gap is pre-H1 rows with `undefined` trustTier — these are filtered cleanly from identityBreakdown by `a.trustTier !== null`.

**Verification packet system** ✅
`computeVerificationPacketCached` at `src/lib/server/verification-packet.ts:65`. KV-cached (30s TTL), falls back to fresh compute. Raw data via `campaigns.getActionsForPacket` (auth-gated). **5 call sites:** campaign detail page load, report preview load, report send action, email-html endpoint, SSE stream. Computed fields (lines 102-161): `verified`, `total`, `verifiedPct`, `districtCount`, `authorship` (individual/shared/unknown/explicit), `dateRange`, `identityBreakdown` (govId/addressVerified/emailOnly/unverified), `gds`, `ald`, `temporalEntropy`, `burstVelocity`, `cai`, `tiers`, `geography` (DistrictWeight[]), `cells` (CellWeight[], H3 res-7, K≥5 floor), `temporal` (hourly bins), `lastUpdated`. **Gap (P0):** org home page packet at `src/routes/org/[slug]/+page.server.ts:83` returns `packet: null` with TODO. VerificationPacket component on the dashboard renders empty.

**Coordination integrity** ✅
All 4 metrics implemented in `verification-packet.ts`:
- **GDS** (`computeGDSFromDistribution`, line 305): 1 − HHI over district action distribution
- **ALD** (`computeALD`, line 320): unique `messageHash` count / total with hashes
- **Temporal entropy** (`computeEntropyFromBins`, line 359): Shannon entropy over hourly bins
- **Burst velocity** (`computeVelocityFromBins`, line 370): peak hourly count / mean of non-zero bins
- **CAI** (`computeCAI`, line 391): (tier3 + tier4) / max(tier1, 1)

Displayed by `CoordinationIntegrity.svelte` with normalized bars + amber warning for burst velocity > 5.

**Tier distribution rendering** 🟡
`computeTierDistribution` at line 403 produces `TierCount[]` with K-anonymity floor (count < 5 → -1). SSOT helper at `src/lib/core/identity/tier-display.ts`. **Gap:** `VerificationPacket.svelte` renders `identityBreakdown` (trust tiers 0-5) as a stacked bar but the engagement tier histogram (0-4: New/Active/Established/Veteran/Pillar) is computed but never rendered. CoordinationIntegrity shows CAI ratio, not the histogram.

**Campaign report rendering** ✅
`src/lib/server/email/report-template.ts:renderReport` produces `{html, text, attestationHash, subject}`. Fully inlined CSS, email-client-safe table layout. Verified count hero, identity composition bar, authorship bar, geography bar (top 8 districts), date range, attestation hash + verification URL. `canonicalPreimage` + SHA-256 → `attestationHash` referenced to `REPORT-ATTESTATION-SPEC v1`. Text fallback at `renderText`. Mobile responsive (`max-width: 560px`). Print/PDF at `src/routes/org/[slug]/campaigns/[id]/report/email-html/+server.ts` with `X-Attestation-Hash` header.

**Specimen / packet display surfaces** 🟡
- Campaign detail (`/org/[slug]/campaigns/[id]`): ✅ VerificationPacket hero with live SSE updates, CoordinationIntegrity below, "Deliver Proof" CTA
- Report page: ✅ Renders `renderedHtml` as iframe preview, past deliveries list with status + response tracking
- Email HTML endpoint (`/report/email-html`): ✅ Standalone printable
- SSE stream (`/api/org/[slug]/campaigns/[campaignId]/stream`): ✅ pushes updates every 30s
- **Org home page (`/org/[slug]`): 🟠 `packet: null`**, VerificationPacket renders empty
- Public verification page (`/v/[hash]`): partial — returns only `dateRange` for anonymity

**Anti-astroturf signal surfacing** 🟡
Burst velocity > 5 → amber warning in `CoordinationIntegrity.svelte:98-102`. GDS < 0.7 + ALD < 0.7 → prose warnings in `IntegrityAssessment.svelte`. **Gaps:** no explicit identical-content flag with threshold; no district-count warning when 0; no coordination-score-over-time chart.

**Trust-tier snapshot at action issuance** 🟡
New actions correctly snapshot `trustTier` at insert (`campaigns.ts:1168`). Pre-H1 legacy rows have `undefined` trustTier; cleanly excluded from identityBreakdown by null filter. The remaining gap is documentation only — the original tech-debt note refers to a pre-H1 condition that no longer applies to new actions.

**Atlas version tracking on campaigns** 🔴
`atlasVersion` is on `groundCredentials` (per-user) but not on `campaignActions`. Campaign-level drift detection at the aggregate level does not exist. H6's `atlasDrift` signal is for individual credentials on `/v/[hash]`, not for campaign packets.

**Campaign-level analytics** 🟡
- Verified-count over time (`CampaignAnalytics.timeline`): ✅ daily buckets, gated by `FEATURES.ANALYTICS_EXPANDED=true`
- Geographic spread (`topDistricts`): ✅ top 10 districts via `GeographicSpread.svelte`
- Delivery metrics (`getDeliveryMetrics`): ✅ sent/delivered/opened/bounced — but `clicked: 0` hardcoded
- Coordination scores over time: 🔴 no time-series
- Verification funnel (postalResolved/identityVerified/districtVerified): 🔴 dashboard hardcoded 0s
- Click tracking: 🟡 SES webhook handler exists but heuristic attribution (loops last 20 blasts)

**Delivery tracking** ✅
Schema at `convex/schema.ts:1733`. `dispatchReportEmails` at `campaigns.ts:1599` uses SES v2 raw HTTP. `sesMessageId` stored for correlation. `updateDeliveryStatus` handles collision with steal policy. Response tracking via `recordResponse` (replied/meeting_requested/vote_cast/public_statement). Past deliveries view at `campaigns.ts:1974`. **Channel coverage:** email via SES works; CWC code complete (`convex/_cwcXml.ts`, 295 LOC) but gated by `FEATURES.CONGRESSIONAL=false`; postal not implemented.

**Per-campaign settings** 🟡
Present: `targetCountry`, `targetJurisdiction`, `debateEnabled/debateThreshold`, `targets[]` (max 50), `billId`+`position`, `districtCode`+`districtCentroid`, `templateId`. Missing: `scheduledAt`, per-campaign sender identity, audience segment filter, embed domain whitelist.

**Campaign templates** ✅
Quota enforced: 10/100/500/1000 by plan tier at `convex/templates.ts:990-999`. Full CRUD via `convex/templates.ts`. **Gap:** no template clone endpoint.

### 3. Email infrastructure

**Compose UI** 🟡
Tiptap (ProseMirror) at `src/routes/org/[slug]/emails/compose/+page.svelte` (1,338 LOC). StarterKit + Link + TextAlign + Underline extensions. Merge-field click-to-insert (`{{firstName}}`, `{{lastName}}`, `{{postalCode}}`, `{{tierContext}}`). Preview via `compileEmail()` → iframe srcdoc. **Gaps:** no type-ahead autocomplete on merge fields; no mobile viewport simulation toggle; HTML-only (no plaintext multipart) across all paths.

**Merge fields / personalization** 🟠
Supported tokens in `compileMergeFields()` at `src/lib/server/email/compiler.ts`: `firstName`, `lastName`, `email`, `postalCode`, `verificationStatus`, `tierLabel`, `tierContext`. **Critical gap:** `compileEmailShell` (the bulk-send path) explicitly does NOT apply merge fields. Code comment: "the bulk send path sends the same bodyHtml to every recipient in a batch, so merge fields would render with empty values regardless." **`{{firstName}}` ships to recipients as the literal string.** Personalization is preview-only; it is not delivered.

**Template system** 🔴
No email-blast template library. `convex/templates.ts` is campaign-template (action letters), not reusable email blast bodies. No save/load for blast composition. Draft autosave (localStorage 2s debounce, 7-day TTL) is the only persistence.

**Email engine** 🟡
- **Path A (client-direct, <500 recipients):** browser decrypts via org key → `sendBlastFromClient` in `src/lib/services/client-blast-sender.ts` → Lambda proxy → SES. Batch 50. **Gap: ses-proxy Lambda not deployed.** `PUBLIC_SES_PROXY_URL` empty in prod.
- **Path B (Convex server-side, ≥500 or fallback):** `sendBlastBatch` in `convex/email.ts`. Batch 100. Hand-rolled SES v2 HTTP with Sig V4. 30s per-recipient timeout. Batches chain via `scheduler.runAfter(0)`. **Gap: no List-Unsubscribe headers on this path.**
- **Path C (TEE-sealed):** `sealAndScheduleBlast` in `convex/blasts.ts`. Not deployed (enclave not live).
- Rate limit: 5 sends/org/hour. Failure: blast → `failed`, no auto-retry.

**ses-proxy Lambda** 🔴 (not deployed)
Code complete at `infra/lambda/ses-proxy/index.ts`: dispatch-claim verification with `BLAST_DISPATCH_SECRET` + rotation-window previous, per-recipient cohort hash, `List-Unsubscribe` MIME injection, CORS pinned to `https://commons.email`. **Status:** not deployed in account `529088283822`. `BLAST_RECEIPTS_SECRET` sync waits on deployment.

**A/B testing** 🟡
UI toggle in compose, separate subject A/B inputs, variant tabs for body, configurable split (10–90%) + test group (10–50%) + winner metric (open/click/verified_action) + duration. `sendAbTest` creates two `emailBlasts` rows linked by `abParentId`. Schema fields exist. **Critical gap: `pickAbWinners` is `console.log("not yet implemented in Convex")`. Cron fires every 15 min, logs, exits.** A/B blasts become orphans. Plan gate: A/B requires Starter+.

**Subject line generation** ✅
Gemini-backed agent at `src/lib/core/agents/agents/subject-line.ts` with structured JSON output. Multi-turn clarification. Retry with forced-output. Rate limit 5/org/hour. **Note:** invoked from campaign Template Creator flow, not from blast compose UI directly — there is no AI suggestion button in the blast subject field.

**Email validation pipeline (Reacher)** 🔴
`infra/reacher/fly.toml` defines a Fly.io deployment for `reacherhq/backend:latest`. `reacherData` field exists on schema. **No application code calls Reacher.** Wrangler secrets documented in comments but not referenced anywhere. Undeployed, unwired infra spec.

**Bounce + complaint handling** 🟡
`processSesWebhook` in `convex/webhooks.ts` receives SNS notifications. SNS signature verification at `_snsVerify`. **Critical gap: only `Permanent` bounces are processed.** Transient/soft bounces silently dropped. Complaint always wins. Suppression via `emailStatus` filter on `getBlastRecipients`. `processBounceReports` cron returns `{ processed: 0 }` (SMTP probing not implemented).

**Deliverability infrastructure** 🟠
DKIM/DMARC/SPF are SES account-level config, not app code. **No per-org custom sending domains:** every org's from is `${org.slug}@commons.email` (hardcoded in 3 places in compose `+page.server.ts`). No domain warmup. No engagement-based throttle. List-Unsubscribe: Lambda path includes it (Lambda not deployed); Convex server-side path does not.

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
`CWCXmlGenerator` class in `convex/_cwcXml.ts`. Generates House XML (CWC v2.0 with `AddressValidation`, `Organization` fields) + Senate XML (simpler schema). `generateOfficeCode` computes `H{STATE}{DISTRICT##}` for House. `validateXML` does string-presence checks. **Transport env vars not set in prod:** `GCP_PROXY_URL` + `GCP_PROXY_AUTH_TOKEN` (House proxy), `CWC_API_BASE_URL` + `CWC_API_KEY` (Senate). `assertCongressionalDeliveryLaunched` blocks any send. `FEATURES.CONGRESSIONAL=false`. **Zero congressional messages can be delivered to any office today.**

**Encrypted witness** ✅
`convex/submissions.ts:create` accepts proof, publicInputs, nullifier, encryptedWitness, witnessNonce, ephemeralPublicKey, teeKeyId. Size caps enforced. Active-credential gate. Tier 4 minimum.

**Web form navigation** 🔵
Explicitly out of scope per product-roadmap. Firecrawl client exists for DM resolution document processing; not for legislative web-form submission.

**Power Landscape composition UX** ✅
Multi-step flow per MEMORY.md: TemplateCreator orchestrates; UnifiedObjectiveEntry single entry; DecisionMakerResolver streaming SSE + ResearchLog thought segments; DecisionMakerResults with DecisionMakerCard/Grouped + CustomDecisionMakerForm; MessageGenerationResolver with subject line agent. `emphasis: federal/state/local/neutral` field in TemplateFormData. ROLE_DISCOVERY_PROMPT explicitly reasons cross-jurisdiction fallback.

**mDL verification at send** 🟡
For CWC: `REQUIRED_CONGRESSIONAL_PROOF_TIER = 4`. Tier 2 users see upgrade prompt. Non-CWC letter campaigns (email delivery) have no ZK proof requirement — `verified` boolean comes from `trustTier >= 2`, not from proof verification at send time.

**Country-code support** 🟠
**US only in production.** `LIVE_RESOLVER_COUNTRIES = ['US']` in `src/lib/server/geographic/types.ts` blocks CA/GB/AU. Resolver code + DISTRICT_CONFIG entries exist for `uk-postcodes`, `au-aec`, but `lookupRepresentatives()` returns `[]`. International route returns HTTP 503. Per `rep-lookup.ts` comment: stubs documented for TheyWorkForYou (UK), OpenParliament (CA), openaustralia.org.au (AU).

**Local government coverage** 🟡
24 slots defined in `US_SLOT_NAMES` (congressional → special districts including water/fire/transit/hospital/library/park/judicial/tribal). H3 cell chunks carry all 24 slots **if populated**. **Only congressional (slot 0) is actually ingested via `congress-legislators`.** State + local officials reach the user only via agentic Exa search.

**District membership proof** 🟡
Three-tree Poseidon2 ZK circuit in `@voter-protocol/noir-prover`. `prover-client.ts` generates proof using cell_id, user_secret, registration_salt, Merkle path. `districtCommitment` is a circuit input. Congressional submissions carry full proof + nullifier. **Non-congressional letter campaigns: `createCampaignAction` carries `districtHash` + `h3Cell` but NOT a full ZK proof.** `verified` from `trustTier >= 2`, not from per-action proof verification.

**Patch-through calling** ✅
`initiatePatchThroughCall` at `src/lib/server/sms/twilio.ts`. Direct Twilio REST (no SDK). TwiML: `<Say>` greeting with optional district verification → `<Dial>` to target. `convex/calls.ts` full CRUD. Status pinned to Twilio's documented set. Signature validation. Requires `TWILIO_ACCOUNT_SID/AUTH_TOKEN/PHONE_NUMBER`. Independent of CWC.

**Multi-jurisdiction routing** 🟡
Data layer: `lookupAllDistricts()` returns all 24 populated jurisdictions per H3 cell. DM Phase 1 prompt reasons across layers. Campaign layer: single `deliveryMethod` per template. **No multi-leg dispatch concept.** Sending the same message to federal + state + local simultaneously requires separate templates.

### 5. SMS / calling / events / fundraising

**SMS blast send** 🟠 (HTTP 501)
`convex/sms.ts` CRUD works. `sendSms` at `src/lib/server/sms/twilio.ts:51` exists. **Dispatch boundary at `src/routes/api/org/[slug]/sms/[id]/+server.ts:56` throws HTTP 501: "SMS blast dispatch is not yet wired."** Reason (line 48-52): org-PII encryption means server can't decrypt phones for batch send. Planned fix is client-side sender (analogous to `client-blast-sender.ts`) or Lambda proxy — neither built.

**A2P 10DLC compliance** 🔴
No brand registration schema, no TCR submission flow, no sample message storage. Marketing copy at `/org/+page.svelte:522` says "10DLC-ready" — aspirational. No Twilio Messaging Service SID configuration. Single from-number via `TWILIO_PHONE_NUMBER` only.

**SMS recipient filtering** 🟠
`smsStatus` field present on `supporters`. STOP/START handling correctly sets `smsStatus: stopped`. `recipientFilter` on `smsBlasts` (tags/segments/excludeTags). **No code reads `recipientFilter` during a send loop** — there is no send loop. `convex/backfill.ts:766` confirms: "SMS dispatch isn't wired yet."

**SMS inbox / reply handling** 🟡
Inbound SMS webhook at `convex/http.ts:579` → `webhooks.ts:440:handleInboundSms`. STOP/START/UNSUBSCRIBE for TCPA only. **No admin queue, no saved responses, no free-text reply capture.**

**MMS support** 🔴 — `sendSms` sends text body only. No `MediaUrl` parameter.

**SMS quota enforcement** ✅ (tracked) / 🟠 (moot)
Plans: free=0, starter=1K, org=10K, coalition=50K. `checkPlanLimits` aggregates from `sentCount`. PATCH route checks before dispatching — then throws 501 anyway.

**Patch-through calling** ✅ (covered in §4)

**Phone banking / predictive dialer** 🔴 — Not built. No dialer, no volunteer assignment, no call queue, no session concept.

**Click-to-call** 🔴 — Not built. No embeddable widget or API.

**Call campaign UI** 🟡
`/org/[slug]/calls` is read-only history. No script builder, no call list management, no volunteer assignment.

**Event CRUD** ✅
`convex/events.ts` create/update/list/get. Supports IN_PERSON/VIRTUAL/HYBRID. Status FSM (DRAFT → PUBLISHED → CANCELLED/COMPLETED). Auto-generated `checkinCode` on creation. Valid event types enforced.

**RSVP collection** ✅
`createRsvp` at `events.ts:508`. Encrypts email + name with org key. Email-hash dedup. Rate-limited 10/minute per email+event. Respects capacity. Status: GOING/MAYBE/NOT_GOING/WAITLISTED. Walk-in sentinels via `publicCheckIn`. **Gap:** WAITLISTED has no auto-promotion when capacity opens (documented at line 416).

**Event map** 🔴 — `latitude`/`longitude` on schema. No map rendering on org events route.

**Attendee management** 🟡
`getRsvps` query paginated with status filter. No full-text search. Check-in functional. No dedicated CSV export.

**Calendar export** 🔴 — No ICS, no Google Calendar link, no Outlook integration.

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

**Donation receipts** 🔴
**`completeDonation` webhook handler (`convex/webhooks.ts:591`) updates status + counters only.** Public donate page (`/d/[campaignId]/+page.svelte:415`) shows "A receipt will be sent to your email" — **no receipt email is wired.** IRS §170(f)(8) compliance gap for c3s.

**Fundraising campaign analytics** 🟡
`listByOrgWithDonors` returns `raisedAmountCents`, `donorCount`, `goalAmountCents`. **Gap:** no recurring conversion rate, no time-series donor charts, no average gift, no geographic breakdown.

**ActBlue integration** 🔴 — No API client, no redirect integration.

**Platform fee** ✅
0% confirmed in `src/lib/config/features.ts:62` and developer docs. No Commons-side fee logic in `processCheckout`.

**Event-driven workflow engine** 🟡
`convex/workflows.ts` full CRUD: create/update/setEnabled/execute, processScheduled cron. Step types: `send_email`, `add_tag`, `delay`, `condition`. **`delay` works fully** (1 min to 30 days). **`send_email` and `add_tag` log `STEP_TYPE_NOT_IMPLEMENTED` at line 614 and continue.** **`condition` always routes else (line 577: `const conditionResult = false; // Default to else path until impl lands`).** Final status surfaces as `partial_no_op`.

**Drip sequences** 🟡 — Delay works; email send does not.

**Trigger conditions** 🟡 — Condition step always evaluates false.

**Automation UI** 🟡 — Visual builder present at `src/routes/org/[slug]/workflows/`. Workflow creation + listing work. Side effects (send/tag) do nothing.

**Multi-org networks (Coalition tier)** 🟡
`orgNetworks` + `orgNetworkMembers` tables. Owner + member orgs with roles (admin/member). Invite/accept/leave/remove via `convex/networks.ts`. **Gap:** no cross-org supporter sharing, no federated list queries, no data-sharing permission model.

**Shared supporter pools** 🔴 — Not built.

**Cross-org reputation portability** 🔴
Engagement tiers per-org. No query spans multiple orgs. `networkStats` type in `CoalitionReport.svelte` accepts aggregated stats but `src/routes/api/v1/networks/[id]/stats/+server.ts:37` returns HTTP 501.

**Coalition verification aggregation** 🔴 (501)
The marquee Coalition value prop — "12 organizations, 4,847 verified constituents across 3 states" — is a 501.

**White-label** 🔴 — Listed as Coalition feature in settings UI. No white-label domain routing, no custom branding override, no subdomain config.

### 6. API + embeds + SDK

**REST endpoints surface** ✅
18 documented v1 route files: campaigns, supporters, events, donations, workflows, sms, calls, tags, networks (+ stats 501), representatives, orgs, usage, keys, docs (OpenAPI), root. Internal `/api/org/[slug]/` surface (30+ routes) is session-auth only — not part of public API.

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

**Versioning** 🟡
`/api/v1/` prefix. No deprecation policy. No `/api/v2/`. No sunset headers.

**OSDI compliance** 🔴
No OSDI implementation. `action_network` appears only as `source` filter enum. No HAL+JSON, no OSDI resource types, no OSDI pagination envelope.

**Webhooks (outbound)** 🔴
Inbound webhooks exist (SES/Twilio/Stripe). **No outbound:** no `orgWebhooks` table, no event dispatch, no signing, no retry.

**TypeScript SDK** 🟡
Full implementation at `packages/sdk-typescript/`. `Commons` class with 13 typed resource classes. `CursorPage<T>` AsyncIterable for auto-pagination. Typed error classes. `package.json` name `@commons-platform/sdk` v1.0.0. **Not published to npm.** No CI publish step.

**Python SDK** 🟡
Full sync + async at `packages/sdk-python/`. `Commons` + `AsyncCommons`. httpx-based. All 13 resource classes mirrored. `CursorPage` + `AsyncCursorPage`. `pyproject.toml` name `commons-sdk` v1.0.0. **Not published to PyPI.**

**Developer docs** 🟡
SDK READMEs complete with quick-start, resource tables, pagination, error handling. OpenAPI at `/api/v1/docs`. **No "Building on Commons" developer portal** — no tutorial site, no webhook integration guides.

**iframe + postMessage** ✅
`/src/routes/embed/campaign/[slug]/+page.svelte` + CSP override at `src/hooks.server.ts` replaces restrictive `frame-ancestors` with permissive. On success, postMessage `{ type: 'commons:action', campaignId, actionCount }` to `window.parent`. Target origin `*`.

**Campaign widget** ✅
Loads via `api.campaigns.getPublicAny`. Fields: name, email, postal, message. Rate-limited 10/min per IP. Submits via `api.campaigns.submitAction` with `source: 'widget'`.

**Postal Bubble in widget** 🔴
No postal lookup or bubble component in `/src/routes/embed/`. Plain `<input type="text" name="postalCode">` — no resolution, no H3 cell.

**Identity verification (mDL) in widget** 🔴 — Session-authenticated only. No cross-frame mDL protocol.

**Verified-action embed** 🟠
Embed records actions via `submitAction` with inherited trust tier. **Embed is anonymous** — no ZK proof generated in-widget, no mDL in-widget. "Verified" in embed = email-deduped at most (trust tier 0/1).

**Widget customization** 🟡
URL params: `?bg=RRGGBB`, `?accent=RRGGBB`, `?hide_count=1`. Hex validated. No CSS variable injection, no custom copy, no logo, no font override.

**Widget analytics** 🔴
No per-embed view tracking, impression counting, or conversion rate. Action count surfaced post-submit only.

**AN OSDI sync tool** 🟠 (covered in §1)

**CSV import with field mapping** 🟡 (UI only — no programmatic API)

**Audit log API** 🔴
No table, no endpoint. Internal ops logged to Sentry + Convex; no structured queryable trail.

**Activity feed** 🟡
`/api/org/[slug]/decision-makers/feed/` (session-auth). Not exposed via public v1.

**Agent trace observability** ✅
`convex/agentTraces.ts` per-event Convex persistence. Indexed by traceId/endpoint/userId/expiresAt. Off-by-default. GDPR cascade via `deleteByUserId`. Hourly TTL cron. Operator access via `npx convex run` only — not a v1 API endpoint.

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
All Stripe webhook events handled in `convex/subscriptions.ts:processStripeWebhook`. `mapStripeStatus()` maps incomplete/incomplete_expired/unpaid/paused → past_due. Schedule events handled. Stripe-managed subscriptions refuse direct cancel via Convex (prevents desync). **Latent bug:** `trialing` is mapped and stored but `effectivelyActive` does NOT include it — a trialing org gets free-tier limits. Silent downgrade if trials are ever activated.

**Plan definitions** ✅
`src/lib/server/billing/plans.ts` 4 plans. All 5 dimensions: `maxVerifiedActions`, `maxEmails`, `maxSms`, `maxSeats`, `maxTemplatesMonth`. Coalition $200/mo.

**Convex mirror** ✅
`convex/subscriptions.ts:17-31` mirrors all limits manually with explicit "MUST stay in sync" comment. No automated drift detection. `backfillOrgLimits` to re-sync.

**Customer Portal** ✅
Owner-gated. `stripe.billingPortal.sessions.create()`. Direct downgrade via checkout blocked with 400.

**Billing UI for orgs** 🟡
Settings page shows plan name, status badge (active/past_due/canceled/trialing), renewal date, usage progress bars (verified actions + emails). Plan comparison grid with upgrade buttons. **Missing:** invoice history, payment method display, no self-service downgrade button (portal-only), no SMS usage meter.

**Webhook handler** ✅
SES bounce/complaint/open/click with SNS dedup. Twilio SMS STOP/START. Donation completion/refund. Stripe correctly delegated to subscriptions.

**Grace period** ✅ (enforcement) / 🟠 (UI)
7-day window via `pastDueSince` field (single-set on first past_due, cleared on active). `effectivelyActive = status==='active' || isWithinGrace`. Settings shows past_due badge but **no countdown banner, no impending-lockout warning.**

**Usage metering** ✅
Period-scoped query-time aggregation — no denormalized counters for verified actions. `verifiedActions` from `campaignActions` via `by_orgId_verified`. `emailsSent` from `emailBlasts.totalSent` where `sentAt >= periodStart`. `smsSent` from `smsBlasts.sentCount`. Free orgs use calendar month; paid orgs use `currentPeriodStart`.

**Quota enforcement gates** ✅
`VERIFIED_ACTION_QUOTA_EXCEEDED` at `submissions.ts:267`. `EMAIL_QUOTA_EXCEEDED` at `email.ts:489`. `TEMPLATE_QUOTA_EXCEEDED` at `templates.ts:1000`. SMS quota at SMS route. Seat limit at `invites.ts:488-508`.

**Metered overage billing** 🔴 (confirmed gap, by design)
Hard block at quota. Accepted residual per MEMORY.md.

**LLM rate limits** ✅
`src/lib/server/llm-cost-protection.ts`. 3-tier (guest/auth/verified). Per-operation + daily global. 3/10/15 per day daily-global. `message-generation` 0/3/5 per hour. `decision-makers` 0/2/3 per hour. `subject-line` 3/5/5 per hour. Per-user or per-IP for guests. Fail-closed unknown ops. Per-isolate in-memory.

**Seat enforcement** ✅
`memberCount + pendingInviteCount >= maxSeats` check. UI shows seat counter + blocks invite form at limit.

**Template quota enforcement** ✅ — 10/100/500/1000 per plan.

**Verification funnel** 🟠
`/org/[slug]/+page.server.ts:51-56` — funnel struct exists but `postalResolved`, `identityVerified`, `districtVerified` are hardcoded `0` with explicit `// TODO`. Only `imported` is real.

**Aggregate metrics** 🟡
`getDashboard` returns supporters/campaigns/members/sentEmails from denormalized counters. Verified percentage not surfaced. **Tier distribution hardcoded `0` for all 5 tiers (+page.server.ts:58-63).**

**Campaign list with packet status** ✅
Recent 10 campaigns with `actionCount` + `verifiedActionCount`. Per-campaign verified/total bar + status badge. Dashboard itself: `packet: null` (TODO).

**Recent activity feed** 🟡
Last 5 supporters as `signup` events. Only `source` as detail. **No verified actions feed, no donations, no email opens.** Type union includes `action` but never populated.

**Dashboard data freshness** 🟡
`getDashboard` is Convex query (reactive) but called via `serverQuery` (SSR, not reactive). Packet KV-cached. Counters denormalized on write.

**Email analytics** ✅
Per-blast totals on `emailBlasts`. `emailEvents` per-recipient. Delivery metrics in `campaigns.getDeliveryMetrics`. Surfaced at `/org/[slug]/emails/[blastId]/`.

**A/B test results** ✅
Side-by-side variant comparison, winner badge, winner send info. `FEATURES.AB_TESTING=true`. **But winner picker is a stub (see §3 above).**

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

**First-run flow** ✅ (6-step, not 5)
OnboardingChecklist: description, issue domains, supporters, verification power (postal resolved), campaign, sent email. Shown when `onboardingComplete === false`. Inline forms. Optimistic UI. `onboardingComplete = hasSupporters && hasCampaigns && hasSentEmail`.

**Demo data / sandbox** 🔴
Acquisition pages say "No demo required." No seed data for new orgs. `convex/seed.ts` is dev-only.

**Invite acceptance** ✅
Token-based, time-limited. `/org/invite/[token]/` handles new + existing user. Resend/revoke from settings.

**Empty states** ✅
Dashboard campaigns empty state with "Assemble your first proof" CTA. Most sections degrade gracefully.

**`/org` landing page** ✅
Full acquisition page with specimen packet, capability tiles, research citations (Walker & Le Socius 2023). Title/description set; **no `og:image`.**

**Segment pages** ✅
`/org/for/state-legislature`, `/org/for/agency-rulemaking`, `/org/for/local-government` — all live. Menu at `/org/for/`. **No `og:image`** on any.

**`/about/integrity`** ✅
Full methodology page with GDS/ALD/temporal entropy lookup tables.

**OG images + meta** 🟠
Campaign OG images exist at `/og/campaign/[id]` (Satori). **Org/segment/integrity pages have `<title>` + meta description but no `og:image`, no `og:type`, no `og:url`.** Social shares text-only.

**Custom from-line** 🟡
From-name configurable per blast (sanitized, max 64 chars). From-address hardcoded `${org.slug}@commons.email`. No reply-to config.

**Custom domain** 🔴 — Listed in plan UI; no DNS verification, no SES identity management.

**SQL mirror** 🔴 — Listed in plan UI; no implementation.

**Branding / White-label** 🔴 — Coalition tier feature in UI. `org.logoUrl` exists. No theming, no child-org relationship beyond network membership, no per-org CSS.

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
`computeTierDistribution` emits TierCount[] with K-anonymity floor. `computeCAI` = (tier3+4)/max(tier1,1). `VerificationPacket.svelte` renders identityBreakdown (trust tiers 0-5). **Engagement tier histogram computed but not rendered (see §2 gaps).**

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
14. + HonkVerifier_{18,20,22,24}, DebateWeightVerifier, PositionNoteVerifier

858 `function test` cases. Deployed on Scroll Sepolia. **No mainnet deployment.** `DeployScrollMainnet.s.sol` exists but no broadcast file.

**SnapshotAnchor** ✅
Live `updateSnapshot()` on Sepolia at `0x461173def8c523a9977c87e989471e74e0ca68fe` anchoring `https://atlas.commons.email/v20260512` (per broadcast file). Used for Shadow Atlas content root, not receipt Merkle.

**DebateMarket** ✅ (Sepolia)
~6,550 LOC test files across 4 files (DebateMarket.t.sol, LMSR.t.sol, AIResolution.t.sol, PositionPrivacy.t.sol). Deployed at `0x972ec06229818684796ae3d3f30a29bf1471eae0`.

**Agentic delegation contract** 🔴 — `FEATURES.DELEGATION=false`. No on-chain contract.

**NitroEnclaveResolver interface stub** 🟡 — `src/lib/server/tee/nitro-resolver.ts` validates HTTPS URL but no enclave deployed. `LocalConstituentResolver` active.

### 9. Debate / accountability / legislative monitoring / Phase 3

**DebateMarket contract** ✅ (Sepolia)
LMSR via PRB-math SD59x18 in `LMSRMath.sol`. Commit-reveal trade scheme with ZK debate-weight proofs. Phase 2 position privacy via `IDebateWeightVerifier`/`IPositionNoteVerifier`. AI panel submission via `IAIEvaluationRegistry`.

**Debate propose** ✅ (with stub)
`POST /api/debates/create` Tier 3+, calls `proposeDebate()`. Off-chain ID fallback when blockchain unconfigured. `POST /api/campaigns/[id]/debate` returns HTTP 501 `campaign_debate_helper_unavailable` — **auto-spawn from campaign threshold is unimplemented.** `convex/debates.ts:679:spawnDebate` enforces Tier 3+ + 5/hr rate limit.

**SUPPORT / OPPOSE / AMEND stake UI** ✅ (with stake stub)
`createArgument` enforces three-stance union. Components: StanceSelector, SubmitArgumentForm, ArgumentCard. `amendmentText` wired. **`convex/debates.ts:createArgument:461`: "on-chain stake verification not yet wired; cap client-provided stakeAmount for now."** Caps stake at $1 placeholder.

**LMSR pricing display** 🟡
Contract math complete. Off-chain `computeLMSRPercentages` used by 5 components. **`debates` records created with `marketStatus: 'pre_market'`; no path transitions to `active` or populates `currentPrices` — requires Scroll on-chain epoch machinery.**

**AI panel evaluation** ✅
`POST /api/debates/[debateId]/evaluate` imports `@voter-protocol/ai-evaluator`. Calls `loadModelConfigs`, `createProviders`, `evaluateDebate`, `submitAndResolve` (DistrictGate.submitAIEvaluation + resolveDebateWithAI on-chain with EIP-712 multi-model signatures). Cron fan-out via `debates.resolveExpiredDebates` daily 02:00 UTC.

**Resolution + appeals** ✅
`/appeal` calls `appealResolution(debateId)`. `/claim` handles simple nullifier claims + Phase 2 private position settlement. `/governance-resolve` for governance path. Status FSM: active → resolving → resolved | awaiting_governance | under_appeal.

**Debate market on campaigns** 🟠
Schema supports `debateEnabled` + `debateThreshold`. `actionCount` tracked. **No cron auto-fires `spawnDebate` when threshold reached.** `POST /api/campaigns/[id]/debate` returns 501.

**Org-side surfacing of debate signal** 🟡
Campaign page loads debate data (proposition, status, deadline, argument count, `aiPanelConsensus`, `resolutionMethod`, winning stance + argument). Renders AI consensus percentage. **"Top argument body" + "market depth $247" style format not present.** Public campaign page renders `DebateSignal.svelte` when `currentPrices` populated.

**Debate participation in tier** 🔴
No code connects debate stake amounts to trust tier or engagement tier promotion. `engagementTier` on `debateArguments` is read from user's existing trustTier — input to weighted scoring, not output that modifies user tier.

**TEE attestation for AI panel** 🔴 — Not deployed. AI evaluation runs from standard server process.

**Accountability receipts schema** ✅
`accountabilityReceipts` schema: `decisionMakerId`, `orgId`, `billId`, `verifiedCount`, `totalCount`, `proofWeight`, `attestationDigest`, `packetDigest`, `proofDeliveredAt`, `causalityClass`, `alignment`, `anchorCid`, `anchorRoot`, `status`, `responses[]`.

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

**Intelligence loop** ✅
`convex/intelligence.ts`: queryItems, getRecent, store, markExpired, ingest (Gemini embedding). DM follow/unfollow, activity timeline, org discovery, bill watch/relevance scoring. **Constituent-level agentic monitoring absent.**

**Multi-country coalition campaigns** 🟡
`targetCountry` is single string field. `targetJurisdiction` is single optional string. **No multi-country array, no coalition aggregation across countries.** NETWORKS works for same-country org coalitions only.

**Per-country verification** 🟡
`importRepresentatives` supports `jurisdictionLevel: 'international'`. ZK proof chain supports multi-depth trees. **CA/GB/AU resolvers stubbed.** No per-country district tree in Shadow Atlas for non-US.

**Coalition aggregation** 🔴
No country breakdown on receipts or actions. No cross-country aggregation. "4,200 verified constituents across 3 countries" claim is absent.

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

## Critical stub inventory (the 23 explicit stubs)

For quick reference. Each is a searchable file:line where the code intentionally short-circuits.

| # | Capability | Status | Evidence |
|---|---|---|---|
| 1 | AN OSDI sync | 🟠 HTTP 501 | `src/routes/org/[slug]/supporters/import/action-network/+page.server.ts:54` |
| 2 | EveryAction + NationBuilder import | 🔴 "Coming soon" tiles | `src/routes/.../import/+page.svelte:707-735` |
| 3 | SMS blast dispatch | 🟠 HTTP 501 | `src/routes/api/org/[slug]/sms/[id]/+server.ts:56` |
| 4 | A/B winner picker | 🟠 Stub | `convex/email.ts:pickAbWinners` |
| 5 | Workflow `send_email` step | 🟠 No-op | `convex/workflows.ts:614` |
| 6 | Workflow `add_tag` step | 🟠 No-op | Same file |
| 7 | Workflow `condition` step | 🟠 Always else | `convex/workflows.ts:577` |
| 8 | Coalition aggregation stats | 🟠 HTTP 501 | `src/routes/api/v1/networks/[id]/stats/+server.ts:37` |
| 9 | Donation receipt email | 🔴 Not sent | `convex/webhooks.ts:591:completeDonation` |
| 10 | Org home page packet | 🟠 null | `src/routes/org/[slug]/+page.server.ts:83` |
| 11 | Dashboard verification funnel | 🟠 Hardcoded 0 | `+page.server.ts:51-56` |
| 12 | Dashboard tier distribution | 🟠 Hardcoded 0 | `+page.server.ts:58-63` |
| 13 | Bulk-send merge fields | 🔴 Literal strings | `src/lib/server/email/compiler.ts:compileEmailShell` |
| 14 | ses-proxy Lambda | 🔴 Not deployed | `PUBLIC_SES_PROXY_URL` empty in prod |
| 15 | Auto-debate-spawn | 🟠 HTTP 501 | `src/routes/api/campaigns/[id]/debate/+server.ts` |
| 16 | On-chain stake verification (debates) | 🟠 Cap at $1 | `convex/debates.ts:createArgument:461` |
| 17 | Congressional delivery | 🟠 Env-gated | `GCP_PROXY_URL` + `CWC_API_BASE_URL` unset |
| 18 | CA/GB/AU rep-lookup | 🟠 Returns [] | `LIVE_RESOLVER_COUNTRIES = ['US']` |
| 19 | Per-supporter bill alerts | 🔴 Missing | `legislativeAlerts` is org-scoped |
| 20 | Outbound webhooks | 🔴 Missing | No `orgWebhooks` table |
| 21 | `campaignParticipation` segment filter | 🟠 No-op | Defined in types, absent from `matchCondition` |
| 22 | `engagementTier` segment filter | 🟠 Labeled pass-through | `convex/segments.ts:99-106` |
| 23 | AI panel TEE attestation | 🔴 Not deployed | LocalConstituentResolver active |

## Cross-cutting missing capabilities

Organized by surface for completeness — see per-domain sections above for individual entries.

### Org foundation
- No org delete, no slug rename, no `customDomain`/`fromEmail`/`replyTo` fields at org level
- No member removal mutation, no role change, no transfer-owner
- Custom fields are opaque blob (no schema, no type system, no UI for definitions)
- No district/state/postal segmentation filter
- No free-text search (hash-based only)
- No double opt-in / consent fields
- No re-engagement triggers / sunset policies / cross-org dedup
- No audit log

### Campaign
- No campaign clone/duplicate
- No `PETITION` campaign type
- No scheduled activation
- No audience segment filter on campaigns
- No sender identity per campaign
- Engagement tier histogram computed but not rendered
- No coordination integrity time series
- No atlas version per campaign action
- No CSV/PDF export of supporters or analytics
- No per-supporter engagement history

### Email
- No email blast template library
- No plaintext multipart (HTML-only)
- No bounce categorization (Permanent only; soft drop)
- No send-time optimization
- No domain warmup / engagement-based throttle
- No List-Unsubscribe on Convex server-side path
- Click tracking attribution is heuristic
- No pre-send checklist / admin sign-off gate

### Power Landscape + decision-makers
- Only federal officeholder data ingested
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
- No SMS inbox / admin reply queue
- No event map (lat/lng present)
- No calendar export (ICS)
- No QR code rendering
- No event CSV export
- No recurring donation cancel UI in org dashboard
- No ActBlue integration
- No subscriber roster for recurring donors

### API + developer
- SDKs unpublished (npm + PyPI)
- No outbound webhooks
- No `/api/v2/` versioning policy
- No OSDI compliance
- No audit log API
- No v1 activity feed endpoint
- No v1 real-time subscriptions
- "No rate cap" claim contradicted by 100 req/min free tier
- No "Building on Commons" developer portal
- Embed widget shallow (no postal-bubble, no ZKP, no per-embed analytics)

### Billing + dashboard
- Trialing status falls through to free-tier (silent downgrade)
- No invoice history UI
- No SMS usage meter on settings page
- No grace period countdown banner
- No metered overage billing (accepted residual)
- No OG images on `/org`, `/org/for/*`, `/about/integrity`
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
1. Org home page packet `null`
2. Dashboard funnel + tier distribution hardcoded zeros
3. Bulk merge fields ship as literal `{{firstName}}` strings
4. Donation receipt UI lies (promises receipt that never sends)
5. OG images missing on org/segment landing pages

### P1 — Blocks AN-refugee migration (the named go-to-market motion)
6. AN OSDI sync returns 501
7. EveryAction + NationBuilder import "coming soon"
8. No campaign clone
9. No district/state segmentation filter
10. `engagementTier` + `campaignParticipation` segment filters are no-ops
11. No member removal / role change
12. Custom fields are opaque blobs
13. No email template library
14. No double opt-in / consent fields

### P2 — Blocks Phase 2 product claims
15. SMS blast dispatch dead (501)
16. A/B winner picker is stub
17. Workflow automation verbs are no-ops
18. Coalition aggregation 501
19. ses-proxy Lambda not deployed
20. Congressional delivery env-gated
21. CA/GB/AU rep-lookup stubbed
22. Custom domain + SQL mirror + white-label listed in pricing UI but not built

### P3 — Blocks Phase 3 differentiation
23. Auto-debate-spawn 501
24. On-chain stake verification stubbed (Convex caps debate stake at $1)
25. Per-supporter bill alerts missing
26. Delegation has data model + Convex CRUD but no execution engine, no UI
27. Cross-border coalition campaigns lack multi-country scope
28. Contracts on Sepolia testnet only
29. TEE not deployed

### P4 — Structural honesty risks
30. `reputationTier` never updates after signup
31. `engagementTier` client-trusted in non-ZK submissions
32. CAI measures the string map, not actual engagement
33. 24 boundary types defined; only slot 0 ingested
34. Trialing Stripe status treats orgs as free-tier
35. MDL_MDOC flag comment stale post-I1

### P5 — Developer platform gaps
36. SDKs unpublished
37. No outbound webhooks
38. "No rate cap" claim contradicted
39. No OSDI compliance in v1 API
40. No audit log API, no activity feed v1, no real-time subscriptions v1
41. Embed widget shallow

## Top 10 launch blockers (ordered)

| Order | Gap | Why first | Effort estimate |
|---|---|---|---|
| 1 | Dashboard packet + funnel + tier distribution wiring | Demo-blocker on every org login | ~half-day in `getDashboard` |
| 2 | Bulk merge fields applied at send | Trust-blocker; documented design gap | Edit `compileEmailShell` |
| 3 | AN OSDI sync actually shipped | Named migration motion is broken | ~1-2 weeks per `action-network-migration-research.md` spec |
| 4 | Donation receipt email + Stripe trial-as-active | Compliance + silent downgrade | One webhook handler + one `effectivelyActive` line |
| 5 | Member removal + role change | Multi-person orgs can't run | 2 mutations + UI buttons |
| 6 | A/B winner picker | Cron-fires-and-exits is worse than disabled | Statistical sig + remainder send |
| 7 | Campaign clone | Top recurring-campaign friction | Single mutation |
| 8 | District segmentation filter | AN-refugee table stakes | Add cases to `matchCondition` |
| 9 | Workflow `send_email` + `add_tag` impls | "Automation" claim does nothing | Wire to existing send + tag |
| 10 | OG images on org pages | Acquisition surface signal | Satori component for org/segment pages |

Closing these 10 moves the org product from "looks finished, partially is" to "actually launchable to first paying orgs."

## Strategic implications

**The verification packet itself works end-to-end.** GDS, ALD, temporal entropy, burst velocity, CAI all computed and rendered. Coordination integrity, campaign reports, attestation hashes, SES delivery tracking — load-bearing flows are real. mDL Android OID4VP is production. Three-tree ZK circuit is production. 858 contract tests pass on Sepolia. The advocacy substrate is there.

**The gap is execution of the surrounding surface.** Areas where the product looks finished but isn't:

1. **The migration story** — AN sync 501, EveryAction/NationBuilder "coming soon" — the named GTM motion has no working path.
2. **The org demo experience** — packet `null`, funnel `0`, tier distribution `0` — prospect logging in sees empty bars.
3. **Phase 2 features marketed as complete** — SMS dispatch 501, workflow no-ops, A/B winner stub, coalition aggregation 501. Built ≠ functional.
4. **Honesty of the tier system** — `reputationTier` set-once at signup, `engagementTier` client-trusted off the ZK path, CAI measuring the string map. Metric shown to decision-makers depends on substrate that doesn't update over time and isn't independently cross-checked.
5. **Listed pricing-tier features unbuilt** — custom domain (Org+), SQL mirror (Org+), white-label (Coalition) appear in pricing UI but have no code. Sales claim vs. delivered capability mismatch.

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

*Source: 9-agent code inspection 2026-05-27. Cross-references: `docs/strategy/product-roadmap.md`, `docs/implementation-status.md`, MEMORY.md, `docs/research/competitive-analysis.md` for what competitors offer at each surface.*
