# Org-Tooling Remediation — Finding → Resolution Map

Closes the org-tooling audit (2026-06-16) via a 16-node do→review hypergraph on
branch `org-tooling-remediation` (cut off `main`). Every work node passed an
adversarial review (RV-*); three integrative gates (RG-1 integrity, RG-2
send-armed, RG-3 distinction) passed after remediating what they caught.

**Mechanical state:** vitest 4,905 passed / 5 skip / 1 todo (300 files); svelte-check
0 errors / 8,116 files; convex tsc 0 errors.

## Integrity — the brand's "no self-refuting claim" (RG-1)

| # | Finding (audit) | Resolution | Verify |
|---|---|---|---|
| A1 | **AttestationVerifier false-mismatch** — the verifier fabricated a preimage and could not reproduce a real campaign's committed hash | Block-paste tolerant parser (`attestation-verify.ts`); verifier reconstructs solely from the recipient's pasted offline block → `computeAttestationHash` (recipient-is-the-oracle, K-anon preserved) | 17 crypto tests incl. render→parse→hash loop |
| A1+ | **Debate campaigns false-mismatch** (RG-1 caught) — the offline-verify block omitted the 11th `debate` field that `canonicalPreimage` commits | `report-template.ts` now prints the debate field (`(no debate)` token → null for non-debate) | debate render→parse→hash test |
| A3 | **"Quota enforced" false label** — verified-action quota shown as a hard cap it isn't | Settings row → `state:'partial'`, "Metered… not a hard cap today"; per-row "ZK proof" → "single SHA-256 attestation"; "International 2026" → undated roadmap | source guard test |
| A3+ | **Marketing-doc false-built claims** (RG-1 caught) — `economics.md` + `competitive-analysis.md` listed SQL-mirror / custom-domain as "Included" | Both relabeled "Upcoming — not yet available" (the product gates them `Not available yet`) | grep = 0 |
| A5 | **Dead vote-tracking / bill-relevance / alerts presented as live** | `LEGISLATIVE_INTELLIGENCE_LIVE:false` gate; UI capability-gated ("not yet available"); marketing hedged ("alert fan-out stays gated") | legislative-deposition tests |

## Send path — the decisive commercial gate (RG-2)

| # | Finding | Resolution | Verify |
|---|---|---|---|
| A2 | DeliveryMetrics mis-classified `/verify/` vs `/v/` verify-clicks | Segment-anchored `isVerifyLink` classifier | webhook-idempotency tests |
| A4 | Webhook events advertised but never emitted | 8-event SSOT catalog + real emitters + parity drift-guard | webhook-event-parity test |
| B1 | **The load-bearing gap** — `deliverToCongress` POSTs to `${TEE_RESOLVER_URL}/resolve` but no in-repo `/resolve` server existed → delivery throws "Service configuration error" | New `src/routes/api/tee/resolve/+server.ts` (internal-secret-gated, wraps `getConstituentResolver`, runs the 3 gates); `CWC_PRODUCTION` sandbox-safety guard (live `messages` prefix refused without explicit prod opt-in → fails safe to sandbox); secret wired both sides | 6 route tests + RG-2 |
| B2 | Studio→congressional handoff **dropped the authored artifact** (bare `?type` hint → blank form); split availability predicate (Studio runtime vs `FEATURES.CONGRESSIONAL`) could "look armed but be dead" | `orgCampaignDraft` store + `saveStudioProcessAsCampaignDraft` carry title/body/targets/counts; one `congressionalDeliveryAvailable` SSOT drives both surfaces (`FEATURES.CONGRESSIONAL` removed from the reveal/allowlist) | 6 handoff tests |
| B3 | Server-dispatch SES path wrote **no per-recipient receipt** (only aggregate counters; the `catch{}` swallowed the recipient that failed before SES) | Loop swaps to `sendViaSesWithResult`, accumulates receipts via the shared writer (upsert / never-downgrade / messageId-on-sent), throw-before-SES records a failed receipt; one positive-allowlist `sendMode` guard incl. `server` | 6 receipt pins |
| B4 | `ses-token` + `dispatch-claim` minted **send authority without a quota check** (form gate bypassable via direct API) | Both gate on `checkPlanLimits` BEFORE the mint, fail-closed; counter mutation rechecks `maxEmails===0` (mid-blast-downgrade backstop) | 7 gate-before-mint pins |

## Capability + perceptual distinction (RG-3)

| # | Finding | Resolution | Verify |
|---|---|---|---|
| C1a | Org couldn't answer "who are my list's representatives?" (`/representatives` is follow/discover only) | No-PII district/state histogram (Convex) + stateless `getOfficials` fan-out (once per district, graceful) → deduped federal roster, every rep `self_declared`, honest `statesMissingSenators`; **never** the per-sender ZK resolver | 9 tests incl. committed no-resolver-import assertion |
| D1 | OS self-refutations: dead signal log, hard space-cut, no scroll memory, one accent, drifting pulses | Live signal merge (honest count, source-discriminated); `visibility` cross-fade (never `display:none`, abs-positioned so active sizes scroll); window-based scroll memory (rAF, clamp, no effect-loop); per-space accent on the active mark; one `--pulse-duration` SSOT | 12 tests |
| D1+ | **Cross-fade RM gate a silent no-op** (RG-3 caught) — override outranked by per-state selectors | RM block raised to (0,2,0) specificity; test strengthened to pin `[data-active]` | computed-style verified |
| D3 | Spotlight/dock/Studio a11y + reduced-motion + layout fan-out | (Wave 1) keyboard/aria, 44px targets, gated flys, single fan-out | RV-D3 |
| D4 | Plan-grace asymmetry, missing field caps, branding-gate | (Wave 1) `effectivelyActive` SSOT, `ORG_FIELD_CAPS`, Coalition gate | RV-D4 |
| D2 | Edge surfaces hand-roll primitives the system provides | **(b)** spring literal → `SPRINGS.METRIC`; **(c)** off-axis palette → 0 in all 4 files (bounce stays error). **Design sign-off obtained → SHIPPED:** **(a)** VerificationPacket → `Ratio` + vertical ledger legend; **(c)** report badges de-pilled to typographic annotations; **(d)** supporters `<table>` → `EntityCluster` (tight, recency-first meta). Review caught + fixed a color-alone email-status a11y defect. | 10 pins + 2 review workflows |

## Decision boundaries (settled)

- **CP-1:** reuse domain `voter-protocol-report-v1` (zero persisted `packetDigest` rows); tolerant whole-block parser; no `privateDigest`.
- **CP-2:** soften "International 2026" to an undated roadmap.

## Not done — and why (honest ledger)

- **Live Senate-sandbox send** (RG-2's literal e2e): the send path is **code-complete, armable, and RG-2-verified**, but the live handshake needs a provisioned Senate `testing-messages` key + Convex TEST env + a TEST-scoped `CONGRESSIONAL=true` build — an **operator/at-signing provisioning step**, not code. Runbook: `docs/design/CONGRESSIONAL-TEST-ARMING.md`. House stays disarmed (`GCP_PROXY_URL` unset).
- **Deferred nodes, untouched as specced:** E1·E2 (backend stub revival), C1b (special-district reach), E3 (SMS), E4 (TEE enclave), E5 (CRM sync).

> **D2 visible-UX migrations — RESOLVED (was here, now shipped).** Design sign-off obtained from the user; the three forks (tight density, vertical legend, recency-first meta) were chosen and all three migrations (Ratio, EntityCluster, de-pill) shipped RV-green. An adversarial review caught + fixed a color-alone email-status a11y defect.
