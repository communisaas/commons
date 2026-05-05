# Repo Check Burndown Task Graph

**Status:** active do/review cycle  
**Date:** 2026-05-01  
**Scope:** second consistency cycle after Ground Vault PRF reconciliation. This
graph targets the remaining `npm run check` baseline and the residual
ground/CWC risks found by explorer review.

## Current Baseline

Initial quantified checker pass for this graph:

| Cluster | Errors | Files | First Error |
| --- | ---: | ---: | --- |
| Convex TS2589 deep instantiation | 687 | 27 | `convex/_rateLimit.ts:17` |
| Convex schema/type drift | 400 | 27 | `convex/analytics.ts:291` |
| Stale/drifted tests | 267 | 41 | `tests/integration/analytics-aggregate.test.ts:9` |
| Routes/pages/API | 206 | 47 | `src/routes/api/agents/stream-subject/+server.ts:180` |
| Core/server/source drift | 42 | 22 | `src/lib/core/agents/providers/gemini-provider.ts:1167` |
| Components/a11y | 11 | 3 | `src/lib/components/template-browser/parts/PreviewContent.svelte:213` |

Changed files account for roughly 171 of 1613 errors; clean baseline files
still account for the majority. The graph therefore prioritizes first failing
clusters and touched-surface correctness over broad refactors.

Post-review checker pass after Cycle 1 implementation:

| Cluster | Errors | Files | Leading Files |
| --- | ---: | ---: | --- |
| Routes/pages/API | 203 | 41 | `src/routes/org/[slug]/emails/[blastId]/+page.svelte`, `src/routes/org/[slug]/representatives/[repId]/+page.svelte`, `src/routes/org/[slug]/+page.svelte`, `src/routes/c/[slug]/+page.svelte` |
| Stale/drifted tests | 150 | 31 | `tests/unit/automation/workflow-engine.test.ts`, `tests/unit/automation/workflow-crud.test.ts`, `tests/unit/analytics-snapshot.test.ts` |
| Convex schema/type drift | 73 | 23 | `convex/templates.ts`, `convex/seed.ts`, `convex/debates.ts`, `convex/supporters.ts`, `convex/backfill.ts` |
| Core/source drift | 35 | 11 | `src/lib/core/agents/exa-search.ts`, `src/lib/core/blockchain/district-gate-client.ts`, `src/lib/core/crypto/org-pii-encryption.ts` |
| Components/a11y | 11 | 3 | `src/lib/components/template-browser/parts/PreviewContent.svelte` |

`svelte-check --output machine --threshold error` reports 472 errors, 146
warnings, and 111 files with problems. The worker-owned ground/CWC/profile/PRF
files have no remaining focused diagnostics after review.

Post-review checker pass after Cycle 2 implementation:

| Cluster | Errors | Files | Leading Files |
| --- | ---: | ---: | --- |
| Stale/drifted tests | 50 | 32 | `tests/unit/identity/passkey-settings.test.ts`, `tests/unit/geographic/scope-inference.test.ts`, `tests/integration/oauth-resumption.test.ts` |
| Routes/pages/API | 41 | 30 | `src/routes/browse/+page.svelte`, `src/routes/verify/receipt/[id]/+page.svelte`, `src/routes/org/[slug]/campaigns/[id]/+page.svelte` |
| Convex schema/type drift | 28 | 12 | `convex/campaigns.ts`, `convex/invites.ts`, `convex/segments.ts`, `convex/events.ts` |
| Core/source drift | 12 | 8 | `src/lib/core/search/index.ts`, stale resolver imports in tests, small crypto/test drift |
| Components/a11y | 1 | 1 | one remaining component diagnostic |

`svelte-check --output machine --threshold error` reports 132 errors, 146
warnings, and 81 files with problems. Cycle 2 also patched Brutalist security
findings on official-delivery consent, template policy, resolver plaintext
release ordering, witness expiry, commitment-query auth, passkey rewrap state,
and ground-vault server-owned state.

## Priority Graph

| Priority | Problem | Target State | Verification |
| --- | --- | --- | --- |
| P0 | CWC launch gate is not enforced inside Convex delivery actions/retry. | SvelteKit and Convex boundaries both reject CWC delivery while launch gate is closed. | Focused grep + `npm run check` / Convex targeted check |
| P0 | Ground vault persistence can still be optional or bypassed after address attestation. | Successful address attestation either writes canonical ground vault/cell state or surfaces explicit re-entry/restore state. | Focused Svelte check and flow grep |
| P1 | Convex first-failure cluster blocks global check. | `_rateLimit`, `analytics`, and `authOps` use type barriers/return validators/ID normalization sufficient to remove their first errors. | `npx tsc ... | rg '^convex/(_rateLimit|analytics|authOps)'` |
| P1 | Profile DTO still exposes raw location metadata. | Profile receives only display-state fields, not raw H3/cell, commitment, internal ids, PRF salt, wrapper, or ciphertext material. | Profile secret grep |
| P1 | Passkey replacement/removal can leave stale wrappers active. | Registration replacement and removal retire/revoke active wrappers for the user. | Focused grep/tests or Convex targeted check |
| P2 | Source drift creates low-risk type failures. | Fix dependency/type drifts in server/source files without changing runtime behavior. | Targeted `tsc`/`svelte-check` |
| P2 | Stale tests encode removed Prisma-era paths and old PageUser shape. | Retire, rewrite, or align tests with current Convex/runtime APIs. | Targeted Vitest where feasible |
| P3 | Residual TEE/deprecated-blob docs contradict active resolver/retired path. | Active docs and test summaries use current LocalConstituentResolver / retired identity blob language. | Focused stale-copy grep |

## Do/Review Gates

| Gate | Do | Review |
| --- | --- | --- |
| G1 | Patch disjoint P0/P1 slices with workers. | Inspect diffs for state-machine regressions and overlap. |
| G2 | Run targeted checks per slice. | Confirm first-error clusters moved and changed-file errors shrink. |
| G3 | Run Brutalist review on changed ground/CWC/security surfaces. | Patch accepted findings or record deferrals. |
| G4 | Run `npm run check`; record exact remaining baseline. | Do not claim global green unless true. |

## Cycle Ledger

| Cycle | Status | Findings | Review Result |
| --- | --- | --- | --- |
| 1 | Completed | Explorers found four high-value lanes: Convex first-failure type-depth cluster, residual ground/CWC launch and vault persistence risks, stale source/test drift, and stale TEE/deprecated-blob docs. | Implemented fail-closed CWC gates, required encrypted ground vault persistence on success paths, redacted profile ground DTO, revoked wrappers on passkey replacement/removal, retired stale TEE/deprecated-blob copy, and cleared targeted first-error filters. Review found and patched five `convex/submissions.ts` self-inference errors. Global check reduced from 1613 errors / 177 files to 472 errors / 111 files. |
| 2 | Completed | Remaining work was dominated by org/campaign route type drift, stale automation/analytics tests, Convex schema drift, and smaller core/source failures. Brutalist review also identified official-delivery consent and plaintext-release issues. | Route worker cleared 135 scoped diagnostics; stale-test worker verified 65 tests under a no-exclude config; Convex worker cleared the requested residual Convex file set; core/component worker cleared all scoped files. Security review patches added explicit official-delivery confirmation, CWC template policy, transport-before-resolver, witness expiry, commitment-query auth, ground AAD validation, server-owned vault/wrapper status, and `rewrap_needed` vault state. Global check reduced from 472 errors / 111 files to 132 errors / 81 files. |
| 3 | Completed | Remaining errors were dispersed: `convex/campaigns`, `convex/invites`, `convex/segments`, passkey/geographic/security stale tests, and small route/page drift. | Convex, route, stale-test, and current-test workers cleared their focused slices. Local review patched remaining test env mutation drift and reran Convex codegen. Global check now reports 291 errors / 121 files. |
| 4 | Completed | New baseline was route-heavy: 271 route errors, 10 core source errors, 6 server errors, 2 tests, 1 Convex file, 1 component. Explorers found DTO-boundary drift, internal/public Convex call typing, stale route contracts, and a few generated API registration gaps. | Workers landed public-route DTO cleanup, org loader contract repairs, a server-only internal Convex adapter, and non-route tail fixes. Integration review consolidated duplicate internal adapters and fixed contact-cache verification typing. Global check reduced from 291 errors / 121 files to 216 errors / 78 files. |
| 5 | Completed | Remaining errors were narrower but still route-heavy: 91 API, 66 org routes, 45 other routes, 8 tests, 4 core source, 2 components. Highest-error files were `api/templates`, `api/v1/supporters`, receipt/delegation/public template pages, org settings/report/org shell pages, and stale API ID tests. | API, org DTO, public leftover, and core-tail workers reduced the repo to 42 errors / 33 files. Org route errors are zero. |
| 6 | Completed | Tail baseline: 33 API errors, 7 non-org route errors, 2 component errors. Remaining failures were mostly branded `Id<>` boundary casts, missing placeholder functions, stale route DTO names, and one debate submit union narrowing issue. | API tail, public-route tail, and component-tail workers cleared all remaining `svelte-check` errors. Final `npm run check` exits 0; machine gate reports 0 errors and 127 warnings. |

## Cycle 4 Task Graph

Baseline after Cycle 3 review:

| Cluster | Errors | Files | Leading Files |
| --- | ---: | ---: | --- |
| Routes/API/pages | 271 | 103 | `src/routes/api/templates/+server.ts`, `src/routes/accountability/[bioguideId]/+page.svelte`, `src/routes/verify/receipt/[id]/+page.svelte`, `src/routes/org/[slug]/campaigns/[id]/report/+page.svelte` |
| Core source | 10 | 7 | `src/lib/core/agents/utils/contact-cache.ts`, `src/lib/core/analytics/index.ts`, `src/lib/core/identity/*`, `src/lib/utils/landscapeMerge.ts` |
| Server source | 6 | 3 | `src/lib/server/smt/revocation-smt.ts`, `src/lib/server/api-v1/auth.ts`, `src/hooks.server.ts` |
| Tests | 2 | 1 | `tests/unit/org/invite-logic.test.ts` |
| Convex | 1 | 1 | `convex/crons.ts` |
| Components | 1 | 1 | `src/lib/components/wallet/debate/SubmitArgumentForm.svelte` |

Task graph for this cycle:

| Owner Slice | Problem | Target State | Review Gate |
| --- | --- | --- | --- |
| Public route DTOs | Accountability, receipt, directory, DM scorecard, profile, delegation, `/s`, and template modal routes leak `unknown`, nullable, or stale field names into Svelte. | Normalize DTOs at server/page boundaries; keep UI behavior and privacy posture unchanged. | Focused `svelte-check` filter for the assigned route list. |
| Org pages/loaders | Org pages use stale Convex function names, old pagination shapes, and untyped `Record<string, unknown>` maps. | Use current Convex arg names and page shapes; map org DTOs before templates; avoid promoting internal functions to public just to appease types. | Focused `svelte-check` filter for `src/routes/org/**` excluding API. |
| API routes/internal boundary | API handlers mix public-only Convex helpers with `internal.*` refs and old Prisma-shaped route contracts. | Add a server-only internal Convex call boundary or local typed adapters, align high-error API routes to current Convex contracts, and keep tenant/auth checks in Convex or server route guards. | Focused `svelte-check` filter for `src/routes/api/**` plus `src/lib/server/api-v1/auth.ts`. |
| Non-route tail | Generated API registration, session DTO, landscape merge fallback, revocation SMT internal calls, contact cache internal calls, and invite literal tests block global check. | Repair current abstractions without broad casts where a small adapter or DTO fix is enough. | Focused `tsc`/`svelte-check` filter for the named tail files and Convex codegen. |

Review notes:

- `convex/messageJobs.ts` should use generated Convex builders if `internal.messageJobs.cleanupExpired` remains missing from generated API.
- `serverQuery` / `serverMutation` should not be used directly with `internal.*` refs unless the type boundary is made explicit and server-only.
- For government/API delivery and ground-vault surfaces, do not reintroduce plaintext logging, client-owned vault state, or official-send auto-advance while fixing route types.

## Cycle 5 Task Graph

Baseline after Cycle 4 review:

| Cluster | Errors | Files | Leading Files |
| --- | ---: | ---: | --- |
| API routes | 91 | 37 | `src/routes/api/templates/+server.ts`, `src/routes/api/v1/supporters/+server.ts`, debate/event/position/org API handlers |
| Org routes | 66 | 28 | `src/routes/org/[slug]/campaigns/[id]/report/+page.svelte`, `src/routes/org/[slug]/settings/+page.svelte`, `src/routes/org/+page.svelte` |
| Other routes | 45 | 11 | `src/routes/verify/receipt/[id]/+page.svelte`, `src/routes/settings/delegation/+page.svelte`, `src/routes/s/[slug]/+page.svelte` |
| Tests | 8 | 2 | `tests/unit/api/api-rate-limit.test.ts`, `tests/unit/api-v1/auth.test.ts` |
| Core/components | 6 | 6 | `message-writer`, missing `analytics/aggregate`, district/mdl identity, debate submit form |

Cycle 5 ownership:

| Owner Slice | Problem | Target State | Review Gate |
| --- | --- | --- | --- |
| API high-error contracts | Template creation nullability, v1 supporter/donation/tag DTOs, debate/event/position/org API stale contracts, API key test ID typing. | Align route handlers and tests with current Convex generated contracts without weakening auth or tenant boundaries. | Focused `svelte-check`/`tsc` filter for `src/routes/api/**`, `src/lib/server/api-v1/auth.ts`, and API tests. |
| Org DTO pages | Org shell/settings/report/email/campaign/supporter/workflow pages still receive `unknown` or stale fields from loaders. | Normalize DTOs at loaders or page boundaries; preserve explicit 501 fallbacks where public Convex contracts are absent. | Focused filter for `src/routes/org/**` excluding API. |
| Public DTO leftovers | Receipt, delegation, `/s`, accountability, profile, template-modal, and debate submit page have residual nullability/shape mismatches. | Resolve nullable bills, delegation grant view types, debate id/string normalization, and component props without privacy regression. | Focused filter for named non-org, non-api route/component files. |
| Core tail | Agent source discovery options, missing analytics aggregate module, identity nullability, mDL option narrowing, component argument typing. | Patch small core/type contracts or add compatibility shims only where behavior exists. | Focused `tsc` filter and any cheap unit tests. |

## Cycle 6 Task Graph

Baseline after Cycle 5 review:

| Cluster | Errors | Files | Leading Files |
| --- | ---: | ---: | --- |
| API tail | 33 | 27 | passkey auth, automation/billing/debate/event/org/position API handlers, revocation witness, network stats |
| Public routes | 7 | 5 | campaign/event/dm page server ID casts, scorecard period nullability, `/s/[slug]` callback arity, template modal metrics |
| Components | 2 | 1 | `SubmitArgumentForm.svelte` stance union narrowing |

Cycle 6 ownership:

| Owner Slice | Problem | Target State | Review Gate |
| --- | --- | --- | --- |
| API tail | Remaining API handlers have branded ID boundary issues, stale helper names, redacted SMS DTO drift, or missing feature functions. | Current generated Convex contracts compile; unsupported endpoints fail explicitly or return safe placeholders without broadening access. | Focused filter for remaining `src/routes/api/**` files. |
| Public route tail | Non-org pages still pass string IDs to Convex, expose nullable scorecard periods, call zero-arg callbacks with args, or pass unknown metrics. | Boundary casts and DTO normalization are local and explicit. | Focused filter for remaining public route files. |
| Component tail | Stance type is over-narrowed at initialization and loop assignment. | Stance union remains `0 | 1 | 2` with typed options and no impossible comparison. | Focused filter for component file. |

Final review gates:

- `npm run check` exits 0.
- `npx svelte-check --tsconfig ./tsconfig.json --output machine --threshold error --no-color` reports 0 errors / 127 warnings.
- `npx tsc --noEmit --pretty false --project tsconfig.json --ignoreDeprecations 6.0` exits 0.
- `npx convex codegen --typecheck=disable` exits 0.
- `git diff --check` exits 0.
- Profile/template ground privacy grep found only type names and value-free lifecycle logs; no raw address, H3/cell, PRF, wrapper, ciphertext, or commitment logging was found.

## Brutalist Security Review Closure

Final adversarial review found five concrete risks. The confirmed issues were
patched before close:

| Finding | Resolution |
| --- | --- |
| CWC delivery ignored template recipient chamber scope. | `convex/submissions.ts` now carries `recipientConfig` into delivery, derives the allowed congressional chambers server-side, and filters Shadow Atlas officials before CWC XML generation. |
| CWC transport failed open to partial chamber configuration. | Delivery now fails before resolver/plaintext release if the template-required chamber transport is missing. |
| Template page exposed `identity_commitment` to browser page data. | `/s/[slug]` keeps identity commitment server-side for Convex queries and no longer returns it in the user DTO. |
| Ground cell metadata was client-steerable. | `convex/ground.ts` binds disclosed cell metadata back to the district credential row and persists canonical credential commitment, slot count, source, and validity times. |
| Legacy email confirmation token targeted latest submission by template. | Confirmation now mutates the exact submission ID carried by the HMAC token, with age and status checks. |

Post-patch gates stayed green: `npm run check`, threshold `svelte-check`,
`tsc --ignoreDeprecations 6.0`, Convex codegen, focused delivery/ground tests,
and `git diff --check`.
