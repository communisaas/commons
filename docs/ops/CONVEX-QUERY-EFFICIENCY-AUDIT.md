# App-wide Convex query-efficiency audit

Last reconciled: 2026-07-20

This is the current launch audit for exported public queries under `convex/`,
their reachable local helpers, SvelteKit `serverQuery(api.*)` consumers, and the
transaction-budget tests that cover risks a syntax scan cannot see. The July
public-discovery incident remains documented in
`CONVEX-PUBLIC-DISCOVERY-IO.md`.

## Current static inventory

`npm run check:convex-queries` currently proves:

| Inventory | Current result |
| --- | ---: |
| Exported public queries | 247 in 38 modules |
| Executable `.collect()` calls | 0 |
| Query-builder `.filter()` calls | 0 |
| Statically resolved `.take()` calls at or above 1,000 | 0 |
| Database pagination inside reachable loops | 0 |
| Reviewed wall-clock reads | 1 query / 1 read |

The sole reviewed exception is
`convex/passkeys.ts::getAuthMaterialByEmail`. Passkey authentication must compare
an exact-indexed, constant-cardinality challenge with the current clock. Its
baseline entry is owned, reasoned, and expires on 2027-01-31.

These numbers replace the pre-remediation inventory of collects, filters, and
clock-bearing queries. Historical findings below are closed implementation
history; they are not open launch findings.

The scanner follows statically resolved local and relative-import helper calls,
including destructured or aliased database/query-builder parameters. It resolves
literal, constant, imported, arithmetic, and common `Math.*` bounds. It cannot
prove document byte size, dynamic dispatch, arbitrary point-read N+1 joins,
custom higher-order iteration, or route-level repetition. Those properties are
covered by the projection contracts and transaction-budget tests referenced
below.

## Historical P0/P1 closure map

| Former risk | Current foundation |
| --- | --- |
| Supporter pages and exports repeatedly reread whole organizations | FND-33 uses indexed cursor pages, bounded joins, byte ceilings, explicit export iteration, and fail-closed legacy overflow. |
| Every org navigation hydrated every workspace | FND-28 makes the root layout a compact shell; workspace routes page their own data and use write-maintained counters/read models. |
| Session validation depended on mutable user rows and request clocks | FND-26 uses a signed local cookie envelope plus one exact session row and compact session-authority row; the SvelteKit hook owns expiry checks. |
| API-key authentication rewrote its own authority document per request | FND-31 separates credential authority, rate-tier signaling, and bounded usage accounting. |
| Public share pages rescanned messages, positions, debate history, and receipts | FND-27, FND-29, and FND-37 use ready-gated campaign, deliberation, and accountability read models. |
| Template list/search/relation reads hydrated embedding-heavy source rows | FND-10, FND-15, and FND-20 use compact source/projection rows, cursor-bounded authenticated lists, and capped snapshot publications. |
| Coalition/network statistics and browse surfaces performed member/action N+1 reads | FND-34 and FND-42 use write-maintained coalition metrics and explicit indexed pages. |
| Always-on workflow, SMS, donation, campaign, receipt, and configuration counts scanned history | FND-25, FND-27, FND-43, and FND-44 use compact counters, summaries, and bounded operator pages. |
| Public catalogs, v1 reads, cleanup, migrations, and backfills admitted corpus-sized work | FND-32, FND-36, FND-38, and FND-49 enforce exact indexes, fixed row/byte/write envelopes, durable cursors, and fail-closed overflow. |

The release hypergraph is the authority for each foundation's acceptance proof.
No ready node may depend on a pending node, and every ready node records exact
commands, tests, artifacts, and a verification timestamp.

## Runtime and transaction proof

The zero-scan ratchet is necessary but not sufficient. Representative
cardinality and byte proof lives in:

- `convex/templates-read-budget.convex.test.ts` and
  `convex/org-shell-read-budget.convex.test.ts` for compact discovery and shell
  reads;
- `convex/templates-authenticated-list.convex.test.ts`,
  `convex/users-template-list.convex.test.ts`, and
  `convex/supporter-browse.convex.test.ts` for cursor and byte-bounded browsing;
- `convex/campaign-read-model.convex.test.ts`,
  `convex/debate-read-boundary.convex.test.ts`, and
  `convex/accountability-read-model.convex.test.ts` for public aggregates;
- `convex/plan-usage-projection.convex.test.ts`,
  `convex/operator-read-models.convex.test.ts`, and
  `convex/observability-service-ping.convex.test.ts` for plan, operator, and
  readiness control planes; and
- the focused contracts under `tests/unit/convex/` that reject executable
  collects, oversized dynamic limits, cursor stalls, unbounded maintenance
  drivers, and direct-origin compatibility fallbacks.

The focused manifest in
`.github/workflows/public-discovery-focused-tests.txt` is append-only for
launch-critical proof: every listed file must exist, run once, and pass.

Prefer cardinality-slope assertions (small versus maximum fixtures) plus byte
ceilings over generous absolute document counts. A large cap can hide O(N)
behavior until production reaches it; a slope assertion exposes the algorithm.

## Guardrail contract

`scripts/check-convex-query-efficiency.mjs` finds public queries through direct,
renamed, namespace, and named-export forms of the generated query factory. It
fails when:

- a public query introduces an executable collect, query-builder filter,
  oversized static take, looped database pagination, or unreviewed clock read;
- a reviewed hazard count changes without an exact baseline update;
- a stale baseline remains after its debt is removed;
- a baseline entry lacks an owner, specific reason, or valid future expiry; or
- an exception expires.

Run the gate with:

```sh
npm run check:convex-queries
```

Baseline regeneration is deliberately not a rubber stamp. A changed exception
requires explicit owner, reason, and expiry metadata and review of the resulting
JSON delta:

```sh
CONVEX_QUERY_BASELINE_OWNER='@your-handle' \
CONVEX_QUERY_BASELINE_REASON='Specific reviewed reason for retaining this debt.' \
CONVEX_QUERY_BASELINE_EXPIRES='2026-09-30' \
node scripts/check-convex-query-efficiency.mjs \
  --print-current --accept-baseline-update \
  | npx prettier --parser json
```

`CONVEX_QUERY_EFFICIENCY_TODAY` is rejected; expiry uses the runner's UTC clock.
CI and the exact-SHA release verification both run this gate.

## Remaining launch work

The query scan itself has no open collection/filter/large-take/looped-pagination
debt. The remaining related gates are deliberately separate:

- FND-30: finish distributed cache/manifest recovery, withdrawal, cost, and
  outage proof without reopening a request-side Convex amplification path;
- FND-60: attach passing agy, Claude, and Codex verdicts to the exact reviewed
  source commit through the signed separate-ref attestation; and
- PD-00: external Convex reactivation and Cloudflare exposure containment.

Do not mark a query foundation open merely because one of those release gates is
pending, and do not mark those release gates complete from this static scan.

## Post-reactivation usage monitoring

After the production team is reactivated, use successful Convex execution logs
as a read-only runtime audit:

```sh
npx convex logs --prod --history 10000 --success --jsonl
```

Aggregate only function identifier, cache-hit state, return bytes, database I/O
bytes, database read bytes, and database document counts. Do not retain
arguments or PII. Report executions, cache-miss rate, total bytes, bytes per
miss, and p50/p95/p99 by function; alert at team-quota thresholds and on
per-function regressions.

Public monitoring must use the zero-dependency `/api/live` endpoint. The
authenticated `/api/health` readiness probe is a separate, low-frequency
control-plane check and must never be exposed as an anonymous uptime target.
