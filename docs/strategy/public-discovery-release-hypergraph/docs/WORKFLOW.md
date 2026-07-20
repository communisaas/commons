# Public-discovery production release

This is the executable path through the hypergraph. The release begins upstream
of deployment: every producer, cache, and paid public boundary must be bounded
before the snapshot producer becomes ready and the edge consumer receives
traffic.

## Foundations: close every launch finding

`FND-10`, `FND-15`, and `FND-20` through `FND-50` may proceed in parallel,
but all converge on `FND-60`. Do not promote a release SHA while any one of
these proofs is absent:

- **Data plane:** homepage selection reads compact, transactionally maintained
  public-card source rows through exact indexed limits. Relation preparation
  reads only bounded embedding rows for selected cards. Purpose-bound
  detail/send routes read a separate at-most-48-KiB projection and exhaustively
  re-allowlist it at the return boundary. Maximum-size source/detail rows and
  768-dimensional vectors must stay below declared transaction read/argument
  budgets; none of these request paths may hydrate full `templates` documents.
- **Compute plane:** distinct tag vectors are selected under a deterministic
  global cap before clustering. Maximum-cardinality tests exercise both
  relation variants and assert explicit retained/shed counts, stable ordering,
  bounded payload bytes, and bounded runtime.
- **Recipient metrics plane:** recipient SSR and public metrics APIs read one
  compact, server-gated aggregate instead of independently collecting messages,
  position registrations, or active decision makers. Every message/position
  writer maintains exact district and total counters transactionally; a durable
  paged migration and explicit readiness cutover cover legacy rows.
- **Session authority plane:** a strict versioned HMAC cookie envelope rejects
  malformed, forged, expired, or implausibly future identifiers locally before
  Convex. One bounded previous key supports rotation and forces active-key
  resealing; every OAuth, passkey, dev-login, and renewal setter signs. Only a
  verified cookie reads one session row plus one deterministic, size-bounded
  user-authority projection. Convex returns stable expiry facts without
  consulting its transaction clock; the SvelteKit request boundary checks
  stored and absolute expiry before minting a token. Identity, relevant profile,
  renewal, revocation, and deletion writers preserve the projection, and a
  bounded fail-closed cutover covers legacy users without making unrelated
  profile history part of every request.
- **Campaign aggregate plane:** organization navigation and campaign detail do
  not independently enumerate historical campaign actions or debate arguments.
  One revisioned, write-maintained aggregate supplies verification packets,
  analytics, timelines, district totals, and bounded debate evidence through a
  request-scoped result and revision-keyed Cloudflare Cache API entry. A durable
  row-and-byte-bounded migration and readiness cutover cover legacy campaigns;
  no paid KV namespace is a correctness dependency.
- **Organization shell plane:** the shared authenticated organization layout
  reads only bounded identity, role, capability posture, and navigation-badge
  state. Campaign, donation, supporter, workflow, SMS, network, legislation,
  and scorecard histories are owned by their feature pages or explicit lazy
  boundaries, so visiting settings cannot inherit an unrelated 21-query
  megafetch. Writer-maintained badges require the same migration and readiness
  proof as every other projection.
- **Public deliberation plane:** recipient pages read a compact debate summary,
  while debate detail and argument APIs use exact-index cursor pages or an
  explicitly bounded top-argument projection. No anonymous request collects an
  entire argument history and then slices it in memory. Argument, co-sign,
  evaluation, appeal, and resolution writers maintain the revisioned summary;
  legacy debates remain unavailable until a bounded migration activates it.
- **Public API authority plane:** every v1 key and every HTTP method consumes a
  finite atomic key/window allowance before endpoint work. Compact key/plan
  authority changes only when credentials or billing authority change;
  request telemetry lives in bounded expiring buckets instead of rewriting and
  invalidating the credential row on every call. A bearer-hash-keyed Cloudflare
  rate binding sheds abusive traffic before Convex; a short Cache API rate-tier
  hint selects the finite plan binding but is never authentication authority,
  and the atomic Convex bucket remains the global exact backstop.
- **Anonymous catalog/artifact plane:** organization directory pages use a
  compact cursor projection; network charters serve their publication-time
  signatory snapshot and hash; fundraiser reads use a completed-status bound;
  event polling reads write-maintained K-floored counters through a one-poll
  cache; dormant whole-table public functions are tombstoned or secret-gated.
- **Supporter operator plane:** browse, filter, search, and browser-side export
  iterate real database continuation pages. No page rebuilds a 10,000-row
  encrypted window or performs an unbounded supporter-by-tag join; role-based
  PII projection and honest filtered continuation remain invariant.
- **Coalition aggregate plane:** authorized network detail, proof pressure,
  reports, and v1 statistics read write-maintained per-org inputs plus one
  revisioned network aggregate, rather than every member's supporter, action,
  receipt, and bill histories. Membership changes invalidate the same bounded
  generation and legacy networks require an explicit cutover.
- **Supervisor plane:** scheduled email readiness, stale-key cleanup, and
  expired-contact cleanup use status-plus-time/expiry indexes, fixed batches,
  durable continuation, and idempotent overlap behavior. A large backlog is
  work to drain, never permission for one whole-table transaction.
- **Email quota and evidence plane:** outbound email admits one immutable source
  cohort through a transactionally serialized sent-plus-reserved period count.
  Reservation replay is idempotent and sent, released, and remaining partitions
  reconcile exactly once. Once a carrier call may have occurred, a timeout,
  non-2xx result, missing SES acceptance id, action loss, or stale lease is
  outcome-unknown: capacity stays blocked and the source is never automatically
  resent. Recovery requires one complete append-only carrier-evidence partition
  and a bounded audited repair. Blast receipt cardinality is a fixed-cap scalar,
  and A/B winner discovery reads a compact scalar projection rather than up to
  500 message bodies.
- **Global contact and carrier plane:** global email and phone denial authority
  outranks organization-local cohort state, while scoped re-enable semantics and
  one serialized epoch make ordering explicit. Inbound STOP, START, complaint,
  bounce, unsubscribe, identity change, and deletion are durable and idempotent;
  ambiguous routing fails closed; fan-out self-pages with retry and terminal
  evidence. Bulk SMS cannot be enabled by flags or credentials while one-shot
  claims are absent. Activation requires one blast-plus-supporter claim directly
  before each Twilio call, durable skipped/accepted/failed/ambiguous evidence,
  no automatic resend of a claimed identity, and health-visible reconciliation.
- **Analytics privacy plane:** the browser, HTTP increment boundary, Convex
  writer, snapshot activation, and crons all fail closed before meaningful work
  while durable global contribution sensitivity is unproven. An enabled plane
  uses exact aggregate identities, eight-row/512-KiB/twenty-write pages, one
  durable epsilon spend per run, secret HMAC-SHA-256 noise, a seed-free narrow
  DTO, hidden partial generations, and evidence-before-source-deletion cleanup.
  Isolate-local throttling is not sufficient contribution authority.
- **Migration and operator plane:** executable Convex contains no unbounded
  collection or post-index query-filter escape hatch. Every schema normalizer,
  enum audit, credential cutover, seed reconciliation, legacy backfill, due
  cleanup, revocation audit, and destructive operator action validates limits
  and cursors before I/O, uses exact indexed row-and-byte-bounded pages, fails
  closed on splits or multiplicity, advances only the work it retains, and has
  a terminal self-draining driver. Scrubbed rows clear their due selector so
  they cannot pin the first page forever.
  Public source-plane activation also requires exact equality between observed
  and classified recipient-loss template/recipient counts. The blocker query
  enumerates each current intent hash; an operator must either obtain fresh
  author re-attestation or record an explicit bounded-reference redaction
  classification against that exact hash, then rerun the paged source migration.
  Classification cannot re-expose unsigned recipient PII. An existing valid
  author-bound detail projection is reusable across version/MAC expiry only
  after the current exhaustive reader validation passes.
- **Accountability plane:** profile receipt history and organization or public
  scorecards use exact cursor pages over compact user-receipt and
  organization-decision-maker projections. They do not rediscover identity by
  scanning supporters and actions or collect every decision-maker receipt to
  filter it afterward. A separately bounded export iterates the same pages;
  writer coverage, privacy boundaries, and legacy cutover are explicit.
- **Authenticated read plane:** user and organization template lists expose
  an embedding-free, transactionally maintained projection through capped
  cursor pages (at most 50 rows and 256 KiB), with explicit continuation
  metadata and a coded overflow from legacy one-shot callers. Every copied
  string has a deterministic byte bound. A paged migrate-then-activate cutover
  is part of readiness, and readers fail closed during a coordinated
  clear/reseed. Campaign detail reads the winning debate argument through its
  exact compound index and keeps navigation and statistics honest about
  page-local data.
- **Refresh and cache plane:** destructive urgency is durable manifest state,
  not authority carried only by a scheduled argument. A later ordinary writer
  cannot postpone it. The manifest is one backend-scoped, ETag-fenced R2 state
  written only by a dedicated-secret cron/producer control path; anonymous Pages
  requests are memory/Cache API/exact-R2-GET only. The dedicated capability is
  checked before Platform work, then a one-minute cron polls one backend-named
  SQLite DO that admits at most one writer per five minutes; bounded `202`
  responses never enter session, Convex,
  Cache API, or R2. Exact-release seeding cannot phase-lock with cron. Authority
  is acquisition-anchored for nine minutes: five-minute admission, release-only
  two-minute seed priority, one-minute poll phase, ten-second HTTP deadline,
  30-second jitter budget, and 20-second reserve. It is locally revalidated after
  60 seconds. Per-family withdrawal epochs survive a ready rebuild; if the writer
  misses the false interval, the epoch advance stages the prior authority as a
  tombstone before prewarm, while retired-revision floors reject every covered
  payload. The producer conditionally publishes both
  list variants and both bundled graph variants before authority, and retires
  only validated exact ring coordinates. Anonymous misses fail closed without
  origin, claim, mutation, LIST, polling, or takeover; a healthy graph request
  spends at most manifest plus one bundled-payload GET. Expired coordinated
  rebuilds alert and remain locked until an operator retries or restores;
  automation never publishes a partial corpus. Outages are negatively memoized
  for 10 seconds without reauthorizing stale manifest or global payload LKGs.
  A newer target that fails immutable publication starts one monotonic
  `publicationLag` at its first trusted R2 acquisition. Retry and supersession
  cannot reset it: prior authority is eligible through exactly 45 minutes and
  denied after that boundary, while terminal Queue failure makes authenticated
  readiness unhealthy immediately. The health proof performs one exact R2 GET.
  Operator rearm is a local ETag/coordinate/evidence-fenced checkpoint CAS; it
  changes only bounded handoff counters, consumes normal Queue admission on the
  next attempt, and cannot clear health. Only a successful complete publication
  clears the lag/terminal state.
- **Operational probe plane:** `/api/live` performs no dependency I/O.
  `/api/health` rejects anonymous callers before Convex, Atlas, R2, or Cache API
  work; authenticated release/readiness probes deliberately revalidate.
  Readiness fails closed on a missing R2 or refresh-gate method surface, or any inactive discovery,
  session-authority, campaign, organization-directory, debate, recipient,
  coalition, charter, supporter, or accountability plane. Direct `pages.dev`
  probes are forbidden. Staging is release-probe-only: the exact candidate
  returns empty `204` with the Access token absent and Cache API unavailable,
  and only its trusted edge emits `candidate-fetch-completed`. Production
  readiness is then proved through `commons.email` after terminal C.
  The first app hook rejects any unexpected production host before Convex
  initialization or authentication if edge origin closure ever drifts.
- **Trusted Pages delivery plane:** separate least-privilege Workers own
  `commons.email/*` and `staging.commons.email/*`; the Pages project's only
  custom domains are `pages-origin.commons.email` and
  `pages-origin-staging.commons.email`. Both Workers use date `2026-07-20`, pin
  only `global_fetch_strictly_public`, and disable public Worker subdomains; the
  finalized Pages candidate uses date `2025-04-01` and exact ordered flags
  `nodejs_compat`, `nodejs_als`, `global_fetch_strictly_public`. Complete live
  inventory rejects any overlapping Access app/policy/token and any stale DNS,
  Pages custom/deployment alias, or Worker route; `staging.commons.email` is
  only the staging Worker route. Each
  hidden origin has a distinct self-hosted Access app and distinct Service
  Token, read only from `x-commons-pages-origin-access`, with exactly one
  Service Auth/non-identity policy. One exact late-transform rule removes that
  header after Access. No-token, malformed, wrong-token, cross-token, JWT-only,
  and cookie-only requests stop before candidate execution. The Access-safe
  adapter requires Cache API to remain unavailable, derives the raw hidden-origin marker, and
  reconstructs the public URL before SvelteKit's pre-hook CSRF check; the app
  hook revalidates the Access assertion/build SHA/transaction and scrubs every
  transport authority. Production checks terminal C before Access or caching.
  Pending P/Q is an expiring singleton, the active C pointer is independent,
  and the newest eight terminal C tuples remain append-only rollback authority.
  Production promotion is Q → trusted edge T → terminal C; C is the final
  authority mutation. Immediately afterward an uncached exact
  `/api/release-origin` request authenticated by its distinct production-only
  proof capability proves the committed Pages/T pair, proof/Access-token absence
  at the candidate, candidate Cache API unavailability, and zero external I/O.
  T strips the proof header before origin forwarding. The trusted edge is
  the sole landing-HTML cache owner. Its named cache admits only anonymous exact
  `GET /`, keys by public host/SHA/transaction/policy, replaces candidate cache
  headers, and owns isolate-local match, origin, write, and byte-capped L1 lanes.
  Match waits 250 milliseconds; origin and caller-visible write work wait one
  second. Unresolved raw operations are quarantined instead of multiplied, the
  sole raw put serializes the newest submitted cacheable pending generation, and
  the 1 MiB L1 serves 60 seconds fresh plus 300 seconds stale-while-revalidate
  with a hard origin-start-anchored 360-second ceiling. Publication changes the
  R2 manifest but not this key: busy colos
  revalidate after 60 seconds and cached low-traffic colos can show old content
  for at most 360 seconds, without a purge secret or API call.
  `Cache-Tag: public-discovery` is future optional acceleration only. Cache is
  per location and every hit still consumes the shared Workers inbound
  allowance. Ordering is not linearizable across isolates; the timestamp bounds
  replay rather than claiming global monotonicity. `FND-35D` is source-ready;
  external Access configuration, protected secrets, and live denial/probe/
  cache/paired-rollback proof remain explicit `PD-50` through `PD-70`
  operator evidence. Paid/no-shared-hard-disable or quota-isolation authority
  and controlled Convex reactivation remain `PD-00` evidence.
- **Deployment exposure plane:** native Pages production and preview deploys
  stay disabled, the public trusted edge identifies a known safe exact SHA, and the
  Pages deployment API is enumerated through every page rather than trusting a
  first-page sample. The settled inventory retains only canonical production;
  an exact staging alias is temporary transaction state during candidate
  qualification and is pruned after production promotion. Every gated
  upload performs the same post-deploy inventory and pruning or quarantine
  before promotion. The exact account Bulk Redirect list and first account
  rule cover the project root and every branch/hash subdomain, path, and query
  with no probe bypass. A dedicated read-only observer proves those control-plane
  objects before every production mode, including containment; token capability
  is never inferred from an unrelated Pages permission. Containment preflight
  is runtime-proved on its protected custom authority before canonical upload.
  For normal production, the consensus-digested production artifact tree is
  uploaded byte-for-byte to the Access-protected release-probe-only staging
  origin first.
  Its client Convex realm is runtime-bound to the isolated preview deployment;
  a trusted pre-upload scan rejects the production origin from every
  client-visible file. Canonical digest, production release metadata, preview
  deployment metadata, and exact inert candidate proof must agree before that
  same directory is re-digested and uploaded to production. A matching Git SHA or a
  separately built staging artifact is not production-artifact proof. Main
  uploads receive metadata/artifact proof only and are never production runtime
  acceptance. Normal Queue/Pages expansion is split into exact-SHA
  `activate-preview` and `activate-production` receipts over that same artifact
  id and digest. Production observations occur only after the staging runtime
  handoff. Each phase journals exact prior state and attempted mutations before
  commands, verifies signed/live authority last before every mutation, and
  reserves enough command deadline for an outer cancellation/crash recovery to
  detach the producer and restore or forward-contain every attempted surface.
  The production phase first proves any retained T with missing, wrong, and
  current capability checks, repeats that proof after capture, qualifies Q,
  deploys and proves T while Q remains fail-closed, then appends terminal C as
  the last action. Failure before C
  contains pending state. Post-C release-origin failure or a later rollback
  restores the retained-C-matching Pages candidate first, then its captured
  trusted edge version, and repeats capability-gated exact
  `/api/release-origin`. Normal Pages proves its exact tuple and origin absence;
  containment proves captured metadata plus deterministic `503` maintenance.
  Public authority is proved without rewinding the Durable Object ledger;
  optional purge failure is only a warning.
  `FND-35` proves these normal endpoint and deployment mechanisms plus the
  recorded 2026-07-19 exposure cleanup. `FND-35C` separately proves the
  trusted-generated, binding-free, zero-dependency containment bootstrap; its
  readiness does not imply that normal application readiness is safe. The live
  replacement artifact, exact-SHA custom origin, and post-upload inventory are
  downstream operational evidence in `PD-00`, `PD-50`, and `PD-70`; requiring
  them before `FND-60` would create a deployment-before-deployment cycle.
- **Cost-abuse plane:** Gemini-backed search is callable only through the
  authenticated server boundary carrying the internal secret and a stable
  actor identifier. Query variation shares one atomic bucket row per
  identity/window. Essential, bounded cleanup removes expired buckets globally.
  Exact anonymous template-detail and OG paths are rejected by an application
  shield before Convex or Sharp, then use bounded schema/backend/origin/slug-keyed
  positive and negative caches with a hard 60-second TTL plus per-isolate
  single-flight. Successful template creation explicitly evicts its detail and
  OG entries; other mutations converge within that TTL. One Free-plan Cloudflare zone
  rate-limit rule is defense in depth for the reviewed public dynamic-route
  inventory. The exact live Free rule blocks after 6 requests per 10 seconds
  for 10 seconds, counts all matched requests, and must be proven with a
  read-only token before a normal production release. Its nominal one-IP/colo
  maximum is 51,840/day against the shared 100,000 Workers/Pages Free allowance;
  enforcement delay and multiple IP/colo buckets mean it is explicitly not a
  global quota. The separate zero-bypass account redirect prevents direct
  Pages-host invocation; the app host hook only prevents data I/O during drift.
- **Queue artifact and operation plane:** anonymous detail and OG reads resolve
  manifest → exact 250-entry inventory → revision-qualified R2 JSON/PNG without
  Convex, rendering, LIST, write, or fallback. The producer publishes JSON first,
  reserves one Queue handoff behind the shared SQLite gate, and advertises a
  coordinate only after exact metadata proves both create-only siblings. Every
  reserved attempt projects `9`, `8`, and `2` operations onto its send day and
  next two UTC days; each realm-day caps at 2,500. Two realms project at most
  5,000. A separate Ed25519-signed account-wide Free receipt uses two complete
  observations at least 15 minutes apart with at least 15 minutes of data lag,
  proves the complete subscription/Queue/identity/settings/backlog inventory,
  and permits at most 2,500 already observed operations. The exact nominal
  maximum is therefore 7,500, leaving 2,500 of 10,000; at-least-once duplicates,
  sibling traffic, and analytics-not-invoice semantics mean that remainder is
  not guaranteed capacity. Receipts last at most 30 minutes, are rejected after
  27 minutes, stay inside one UTC day, bind one exact phase/SHA/realm, and require
  post-mutation live proof. The Queue consumer source cap is exactly 100 ms; cold
  proof measured 26.5–28.1 ms. Live verification applies Cloudflare's
  Queue-consumer 30-second default/configurable-five-minute CPU class and proves
  the exact deployed artifact/limit. `FND-40B` is source-ready. No signer or
  live phase receipt is enrolled yet, so `PD-00` and `PD-50` remain closed.
- **Cold-corpus bootstrap plane:** normal production publication gets one
  receipt-deadline-fenced manifest seed request; it is never the unbounded path
  for a first corpus. Before production activation, a read-only exact-key R2
  verifier proves a stable ready manifest, completed coordinate checkpoint,
  inventory, and every JSON/PNG pair. Only its typed missing/incomplete result
  opens bootstrap; access, bucket, network, decoding, and other operational
  errors stop release. Wrong account or malformed/missing verifier credentials
  use the distinct `PUBLIC_DISCOVERY_BOOTSTRAP_CONFIGURATION_ERROR:` prefix and
  also stop release; only `PUBLIC_DISCOVERY_BOOTSTRAP_INCOMPLETE:` opens the
  cold branch. Every warm or cold handoff consumes a source/SHA/transaction/
  operator-bound schema-2 Queue receipt with 4,320-second admission. Before
  Queue consumer code can change, a signed live proof requires the exact
  existing consumer identity and work budget, unpaused delivery, zero producer,
  and zero backlog. The workflow then deploys the finalized consumer with exact
  `PUBLIC_RELEASE_SHA` and `PUBLIC_RELEASE_TRANSACTION_ID` bindings and proves
  live convergence, including response-loss recovery. Only the cold branch
  temporarily deploys the immutable finalized Pages Worker on the canonical
  hidden refresh path. The signed delta permits exactly one additional producer,
  `commons-public-discovery-bootstrap` on the existing production Queue. A
  3,960-second proof must observe exactly baseline plus that producer before
  work; no Queue/DLQ/settings/consumer/unrelated authority may change. Existing
  Access remains first authority, and a negative canary proves anonymous denial
  before Worker execution plus application-auth rejection of an Access-admitted
  deliberately invalid refresh credential before any data or coordination I/O.
  A separate exact-tuple authority permits at most 60 minutes and the workflow
  arms 59. At most 25 typed continuation attempts stop with ten minutes left;
  exact-key, no-LIST R2 completion polling may use the next five minutes and
  route-first/script-second cleanup retains the final five. Only the bootstrap-
  specific completion endpoint can certify the ready generation. Cleanup and
  the terminal Queue oracle both run after earlier-step failure. Success
  re-proves stable exact R2 state; every warm/cold terminal path then proves the
  signed consumer identity, unpaused delivery, zero producers, and zero backlog
  with at least 180 seconds of receipt validity. Append-only private custody records
  `intent → deployed → cleaned`; independent protected recovery can contain the
  exact owned route/script even if the normal production journal never existed.
  Finalized-artifact source closure includes the adapter plus bootstrap runtime
  and protocol module. `FND-40C` is source-ready; its live cold run remains
  downstream of external Convex reactivation and fresh receipts at the two
  protected approval seams.
- **Direct Convex authority plane:** Cloudflare cache, WAF, and the Pages-only
  Durable Object cannot protect `*.convex.cloud`. The generated AST manifest
  classifies every public query, mutation, and action exactly once as
  secret-first, authenticated/role-first, HMAC-first, pre-I/O retired, or
  explicitly I/O-free. The current 457-export surface contains 172
  server-secret gates, 254 authenticated/role gates, 5 HMAC gates, and 26
  tombstones; `servicePing` is internal. All 192 server-secret callers prove the
  canonical server secret source. The 12 intentional browser-direct operations
  are explicitly enumerated, identity/role-gated, and cardinality-bounded; all
  other browser/server dynamic references, factory aliases/re-exports, stale
  manifest rows, spoofed guards, and pre-authority unknown work fail CI.
- **Legacy correctness plane:** lease failures use structured Convex codes;
  embedding repair derives domain hue; metadata-only patches validate only the
  changed projection fields while grandfathering untouched legacy config; and
  an exact endorsement counter is lazily repaired and drained by a bounded
  migration rather than inferred from the six-row avatar sample.

The checked graph records every source foundation except `FND-60` as `ready`.
Here, `ready` means the bounded mechanism, workflow choreography, recovery path,
and executable source proof are implemented. It does not mean the release or an
external provider state is ready. The live Convex cron/work inventory,
reactivation and quota isolation, WAF and origin closure, Queue signer/receipts,
Access applications and tokens, deployed Queue/Worker/Pages state, denial/cache
timing, and rollback execution remain `PD-05`, `PD-00`, and `PD-20` through
`PD-70` gates. In particular, `FND-35C` readiness makes `PD-05` source-eligible
only; detached `FND-60` review and the external containment mutation remain
open, and no source node self-attests normal application activation.

`FND-35D` source readiness likewise cannot self-attest the two Access
applications/tokens, late transform, hidden-domain inventory, live denial
matrix, deployed trusted Worker versions, candidate echo/cache proof, or
production Convex reactivation. Those launch-blocking facts stay external.

`FND-60` never becomes `ready` in source S. Review authority cannot be written
by the tree it approves. A protected verifier at immutable gate commit T reads
S only as Git objects, verifies the agy, Claude, and Codex evidence in detached
signed proof commit A, and binds A to exactly T, S, repository id, repository
slug, reviewer runtimes, and allowed signers. CI may validate source graph
structure and implemented foundations, but only this T/S/A proof can authorize
PD-05 or production publication.

A deliberately unavailable feature is acceptable only when its hold is
non-overridable and occurs before credentials, request-body parsing, cohort
reads, database writes, or carrier calls. For this release, SMS carrier delivery
stays held until the per-recipient one-shot plane in `FND-47` exists, and
analytics ingestion/publication stays held until the durable contribution
authority in `FND-48` exists. An ordinary feature flag, missing UI, or absent
provider credential is not release evidence.

## 0. Bootstrap protected authority, then contain the frontend

Containment precedes Convex reactivation: `PD-05 -> PD-00`. First land the gate
scripts, allowed signers, and hardened workflows on protected `main`; the
workflow binds T directly to `github.workflow_sha` and requires that exact
commit to remain the current protected-main head; then generate detached signed
proof A for exact production source S with base T. No mutable repository
variable may select or downgrade T. Until T is current on protected main and A
verifies, production publication is intentionally unavailable.

Before any credential-bearing dispatch, repair GitHub's external control plane:

1. Restrict both `Production` and `Staging` GitHub Environments to deployments
   from protected `main`, disable administrator bypass, and require reviewers.
   Protect `main` with strict, GitHub-Actions-app-bound `test`, at least one
   non-stale approval, last-push approval, resolved review threads, and no
   administrator, force-push, deletion, or pull-request bypass.
2. Revoke and delete repository-level Cloudflare, internal-readiness,
   manifest-refresh, Anthropic, Codex, agy, and GLM credentials. A branch-owned
   workflow can reference repository secrets regardless of checks in main.
3. Rotate the provider/runtime values and enroll only least-privilege
   `PROTECTED_CLOUDFLARE_API_TOKEN`, `PROTECTED_CLOUDFLARE_ZONE_ID`,
   `PROTECTED_INTERNAL_API_SECRET`, and
   `PROTECTED_DISCOVERY_MANIFEST_REFRESH_SECRET` in the appropriate protected
   Environment. Reviewer credentials stay outside ordinary repository Actions;
   detached signing or a separately controlled GitHub App owns A.
4. Enroll only the two narrow pre-Environment observation secrets at repository
   scope: `PROTECTED_GITHUB_RELEASE_AUTHORITY_READ_TOKEN` is a single-repository
   fine-grained token with `Actions:read` and `Administration:read`, and
   `PROTECTED_CLOUDFLARE_WAF_READ_TOKEN` has `Zone:read` and `Zone WAF:read` for
   `commons.email`. They cannot publish or mutate production. GitHub's ordinary
   workflow token cannot read branch protection, while public ruleset detail
   omits bypass actors, so absence or permission drift must block release. Give
   the GitHub token a finite expiry of at most 90 days, record its owner and
   expiry in the operator secret inventory, rotate it at least seven days before
   expiry, prove the replacement in source verification, and revoke the old
   token immediately afterward. Rotation must never widen repository scope or
   permissions.

Dispatch the workflow definition from protected main while treating branch and
ref as inert target inputs:

```sh
gh workflow run deploy.yml --ref main \
  -f branch=production \
  -f ref="$RELEASE_SHA" \
  -f mode=containment
```

Containment skips both candidate builders and artifact consensus. The
credential-bearing job checks out only T, generates the standalone Worker and
metadata locally from T plus exact S, canonical-digests and validates that tree,
proves it on an isolated Pages preflight, and only then publishes production.
Containment is a Pages-only artifact: it neither packages
nor captures, deploys, or rolls back the gate/cron Workers. Both preflight and
production use the trusted binding-free config; authenticated readiness fails if
R2 or the manifest-gate binding is present and makes no dependency call. It must report
`preserved=0`, and a live request to the
previous immutable Pages URL must be blocked. A failure forward-deploys the
already proven containment artifact; it never restores the old quota-amplifying
canonical. Attach the workflow URL, T/S/A values, preflight and custom-domain
zero-I/O output, final inventory, and old-URL retirement output to `PD-05`.

Only after PD-05 is live may the billing administrator begin `PD-00`. First
record a recovery-epoch millisecond lower bound and pause both exact Commons
deployments while the team is still disabled. A state-only proof must find a
provider pause audit event at/after that bound, zero later unpause/running
events, and `user=paused` at both backend-state reads; system/usage disablement
is recorded but does not substitute for the user pause. The history scan pins a
small four-page/25-result budget to one upper fence, then after the final paused
state read requires a complete one-page overlapping audit tail. It uses a
separate exact-deployment `deployment:auditLog:view` key from the
`deployment:data:view` inventory key. Exclusive unpause-authority custody begins
at the tail transaction. If any of that is unavailable, Convex support for an
atomic pause/reactivation control is an external P0.

Upgrade or reactivate the team with both deployments still paused. Capture the
active scheduled inventory before mutation; cancel or explicitly disposition
pending work, while any action first observed `inProgress` also needs
execution-specific completion/support evidence because cancellation does not
stop an already-started action. Freeze `CRON_PROFILE=contained` by deploying the
reviewed SHA to both while paused; and run the same audit-backed paused proof
with exact empty cron inventories plus a page-one empty indexed active-work
result in both realms. Only then may an administrator resume them, disable any
uptime request to `/`, prove one bounded production service ping, repeat the
scheduler/cron proof with exact all-`none` running state, and record quota
headroom for bounded rebuilds. The containment artifact remains canonical
throughout backend recovery.

The frontend cache continues to use the dedicated Standard R2 bucket
`commons-public-discovery-cache`, bound only as `PUBLIC_DISCOVERY_R2`, with r2.dev
and custom domains disabled and no age lifecycle on `public-discovery/`. Exact
producer ring retirement bounds storage without deleting an unchanged current
object. The credential gate removes only the obsolete eight-day lifecycle rule,
preserves and re-reads unrelated rules, and rejects any other enabled destructive
overlap. The manifest writer uses the independent
`DISCOVERY_MANIFEST_REFRESH_SECRET`; its outer capability hook rejects invalid
traffic before session lookup, Convex, R2, or Cache API work.

## 1. Deploy the backend producer

Use a clean worktree at the release SHA. The Pages workflow intentionally does
not deploy Convex because this repository has no established Convex deploy
credential in that workflow.

```sh
npx convex deploy --env-file .env.production --dry-run --typecheck enable
npx convex deploy --env-file .env.production --typecheck enable
# Exactly once after this schema/functions push; do not start Pages producer/readiness first.
npx convex run --env-file .env.production templates:migratePublicDiscoveryManifestAuthority '{}'
npx convex run --env-file .env.production templates:publicDiscoveryManifestAuthorityOperatorStatus '{}'
# One-time bounded legacy cutovers; omit after each reports its terminal state.
npx convex run --env-file .env.production templates:migrateTopicEmbeddingMarkers '{}'
npx convex run --env-file .env.production templates:topicEmbeddingMarkerMigrationStatus '{}'
npx convex run --env-file .env.production templates:migrateEndorsementCounts '{}'
npx convex run --env-file .env.production templates:endorsementCountMigrationStatus '{}'
npx convex run --env-file .env.production templates:migratePublicDiscoverySourcePage '{}'
npx convex run --env-file .env.production templates:publicDiscoverySourceMigrationStatus '{}'
npx convex run --env-file .env.production templates:activatePublicDiscoverySourcePlane '{}'
npx convex run --env-file .env.production templates:publicDiscoverySourceMigrationStatus '{}'
npx convex run --env-file .env.production templates:migrateTemplateListProjection '{}'
npx convex run --env-file .env.production templates:templateListProjectionMigrationStatus '{}'
npx convex run --env-file .env.production templates:activateTemplateListProjection '{}'
npx convex run --env-file .env.production templates:templateListProjectionMigrationStatus '{}'
npx convex run --env-file .env.production templatePage:migrateRecipientMetrics '{}'
npx convex run --env-file .env.production templatePage:recipientMetricsMigrationStatus '{}'
npx convex run --env-file .env.production templatePage:activateRecipientMetrics '{}'
npx convex run --env-file .env.production templatePage:recipientMetricsMigrationStatus '{}'
```

The manifest-authority status is the first post-deploy release gate. It must
report `ready:true`, `matches:true`, and `bytes <= maxBytes` before any Pages
producer/readiness request is permitted. The public manifest query reads only
that compact singleton and deliberately has no fallback to the wide scheduler,
failure, and migration row. A normal release invokes the migration exactly once;
an additional invocation is a separately diagnosed repair, not routine rollout.
The CLI-safe internal status and the server-secret public
`publicDiscoveryManifestAuthorityStatus` share one implementation; the Pages
pre-upload verifier independently requires the latter through its read-only
Convex client.

The topic-marker migration self-pages in four-row transactions and never calls
Gemini; it marks only already-valid legacy topic vectors. Poll its status until
it reports `"status":"complete"` before any embedding repair.

The endorsement migration recomputes one template per transaction and stops
with `"status":"blocked"` rather than guessing when a legacy template exceeds
the exact 500-endorsement repair bound. Poll until it reports
`"status":"complete"`, `missingCounterTemplateId:null`, and no failure. If an
operator has corrected an overflow, resume from the durable cursor with
`templates:migrateEndorsementCounts '{"resume":true}'`; use `restart:true` only
for an intentional full recount.

The compact-source migration reads at most four full legacy templates per
transaction and self-pages under one generation token. Poll until it reports
`"status":"migrated"`; require `rejected:0` and
`sourcesWritten == eligible`, then activate it exactly once and verify
`"status":"ready"`. Topic-vector and tag-vector counts may be lower than the
eligible count because templates without valid embeddings remain truthful
vectorless cards. Activation is deliberately separate: before it, snapshot,
search, and seed producers fail closed instead of falling back to the
embedding-bearing `templates` corpus.

The authenticated-list migration also self-pages, reading at most four
canonical templates per transaction. Poll until it reports `"status":"migrated"`,
with `failureCode:null`, `failureTemplateId:null`, and `scanned == projected`;
then activate it and require `"status":"ready"`. A blocked byte-split or row is
an operator stop, never an invitation to skip data. Correct the coded cause
before using `restart:true`. Profile, user, organization, and campaign list
readers stay fail-closed before activation and throughout a coordinated
clear/reseed.

The recipient-metrics migration self-pages through legacy `messages` at four
rows and 5 MiB per transaction, then `positionRegistrations` at 32 rows and
2 MiB. Poll until it reports `"status":"migrated"`,
`"phase":"complete"`, and equality for both scanned/projected pairs. Activate
only after those exact checks and require the final status to be `"ready"`.
`"blocked"` is an operator stop: repair the recorded source row and use
`{"restart":true}`; marker and aggregate updates are transactional, so a
diagnosed restart is idempotent. The canonical recovery details are in
`docs/ops/RECIPIENT-METRICS-CUTOVER.md`.

For a brand-new empty deployment, activate the compact manifest authority, then
complete the empty endorsement, compact-source, authenticated-list, and
recipient-metrics migrations and activate all three compact planes before
running `seed:seedAll` or `seed:seedPublic`; all later seed inserts then maintain
the active generations transactionally. These completed cutovers are durable
and routine deploys must not rescan the corpus. Do not push or dispatch the
frontend consumer yet.

## 2. Rebuild and close the readiness gate

For any non-first publication, record the current manifest revisions and confirm
that an available pre-rebuild backup/export can recover the singleton data if a
logically bad rebuild succeeds.

```sh
npx convex run --env-file .env.production templates:rebuildHomepageSnapshots '{}'
npx convex run --env-file .env.production templates:publicDiscoveryManifest '{}'
```

The rebuild is a go only when:

- `templates:endorsementCountMigrationStatus` is complete with no missing
  counters or failure, and `templates:publicDiscoverySourceMigrationStatus` is
  ready with zero rejected rows and `sourcesWritten == eligible`; and
  `templates:templateListProjectionMigrationStatus` is ready with no failure
  and `scanned == projected`; and
  `templatePage:recipientMetricsMigrationStatus` is ready, complete, and has
  equality for both scanned/projected pairs;
- `templates:publicDiscoveryManifestAuthorityStatus` remains `ready:true` and
  `matches:true`, with `bytes <= maxBytes`;
- list and relation selection use their declared exact indexed caps, each
  relation variant's card cap is `50`, and the producer reports no byte/CPU
  budget violation or unexplained source shedding;
- list/relation corpus counts are nonzero for the current production corpus;
- both list rows and both relation rows are below `900000` bytes;
- the manifest reports `list.ready` and `relations.ready` with nonzero
  revisions; and
- both manifest timestamps are no more than 26 hours old, allowing two hours
  of scheduling tolerance beyond the daily `essential` cron cadence.

A thrown rebuild is atomic and preserves the prior committed snapshots. A first
deployment must therefore finish this step before the frontend can expose its
honest-but-empty cold state.

Run the server-authenticated verifier and inspect Convex logs before frontend
upload. The large snapshot functions reject calls without
`INTERNAL_API_SECRET` before database I/O, so do not place the secret in CLI
arguments or logs. With `PUBLIC_CONVEX_URL` and `INTERNAL_API_SECRET` loaded in
the verifier process:

```sh
npm run verify:public-discovery-readiness
```

The verifier brackets both list and relation variants with two manifest reads
and then reads the private producer state. Authorized snapshot reads must touch
only `publicDiscoveryManifestAuthority`, `publicTemplateSnapshots`, or
`templateRelationSnapshots`; they must not hydrate the wide
`publicDiscoveryManifest` control row or collect the embedding-bearing
`templates` corpus. Each payload's `revision` must equal its corresponding ready
manifest revision. An anonymous `ConvexHttpClient` call to any large discovery
singleton must be denied before reading its snapshot row.

If `clearSeed` or `reseedTemplates` is interrupted under the contained profile,
the acquisition-armed, token/attempt/timestamp-scoped watchdog consumes no idle
ticks and stamps the expired coordinated lease once before emitting a PII-free
alert. A renewed owner creates exactly one successor watchdog; cleared,
duplicate, delayed, and predecessor invocations do nothing. The optional
15-minute essential supervisor is only a later belt-and-suspenders scan after
quota activation. Neither path clears the token or publishes an intermediate
corpus. Inspect the manifest and original action failure, then retry the same
owning action after the lease has expired. Its new token may replace only a
stale generation and the lock is released only after both snapshot families
publish successfully:

```sh
npx convex run --env-file .env.production \
  observability:superviseCoordinatedPublicDiscoveryRebuildLease '{}'
npx convex run --env-file .env.production templates:publicDiscoveryManifest '{}'
# After correcting the original failure, choose the action that owned the lease:
npx convex run --env-file .env.production seed:clearSeed '{}'
# or: npx convex run --env-file .env.production seed:reseedTemplates '{}'
```

Never manually delete the lease fields or invoke a tokenless rebuild to escape
this state; that would discard the proof that the source corpus is stable.

## 3. Deploy the same frontend SHA

Keep Cloudflare Pages native Git production and preview deployments disabled,
then dispatch the exact verified SHA. The workflow definition must come from
protected `main`; `branch` and `ref` identify inert source S and never select
the workflow authority. Both protected Environments must already enforce the
main-only deployment policy described in step 0:

```sh
gh workflow run deploy.yml --ref main \
  -f branch=production \
  -f ref="$RELEASE_SHA" \
  -f mode=normal
```

The workflow queries the public manifest, both list variants, and both combined
relation variants before upload, then reads the `_secret`-gated
`observability:discoveryProducerStatus` query last. It refuses a cold manifest,
an incomplete endorsement/source/list/recipient migration, durable producer
failure, an elapsed producer overdue time, empty production corpus, revision
skew, an oversized serialized payload, or a materialization timestamp more
than 26 hours old. Contract-only preview verification relaxes corpus age and
content requirements, not producer health. Anonymous
`observability:servicePing` callers receive only generic liveness and
storage-readability booleans.
Two independent no-secret jobs build the immutable Cloudflare Pages artifact.
Before either canonical digest, immutable T installs its exact locked Wrangler
with lifecycle scripts disabled, copies only the bounded Svelte closure
(`cloudflare`, `output/server`, and `cloudflare-tmp`) into an isolated directory,
and performs one minified dry-run bundle. Only static Pages output and the final
self-contained `_worker.js` enter the artifact; Svelte build internals do not.
The two reviewed optional packages absent from both the candidate lock and
installation (`redis` and `@voter-protocol/ai-evaluator`) resolve to exact
trusted throw-on-module-initialization stubs. The finalizer proves that each use
remains the reviewed caught dynamic import; an installed package, a static or
additional import, or changed catch semantics fails closed. Only Node,
Cloudflare, and workerd built-ins may remain external. The finalization record
binds the exact stub content, Wrangler package identity, Worker hash, and
deterministic gzip size, which must remain below the 2,900,000-byte release
ceiling and therefore below Cloudflare's 3,000,000-byte limit. Nothing mutates
the artifact after its digest. The trusted candidate entry uses the Access-safe
adapter instead of dereferencing `caches.default` at module initialization. It
reconstructs the public URL before SvelteKit's pre-hook CSRF work, while the app
hook verifies and scrubs the Access assertion, raw hidden-origin marker, SHA,
and transaction.

The protected T-only job validates and uploads that exact tree with
`--no-bundle`; staging candidate proof, production publication, and containment
recovery all re-prove the digest immediately before upload. It deploys the
separate staging trusted edge with its distinct Access token and purpose-only
probe secret. The only successful candidate execution is exact
`GET /api/release-candidate`: the hidden Pages origin returns empty `204` with
the Access token absent and Cache API unavailable, and the trusted edge emits
`candidate-fetch-completed`. The workflow then qualifies preview authority and
appends preview terminal C.

Production repeats live Access overlap and alias inventory, cross-token denial,
exact runtime dates/flags, binding, route, strict-public-fetch, hidden-domain,
late-transform, and external phase proof. Capture, restoration, and retained-pair
proof all use the same exhaustive route oracle with an explicit present/absent
expectation, so a wildcard, null-script, duplicate, undeclared specific route,
or incomplete inventory cannot hide behind a filtered expected pair. It
also proves any retained T before Q and again after capture but before T
mutation: missing and wrong capabilities return `421`, while the protected value
must prove the retained journal tuple. Normal Pages reports exact tuple and
origin absence; containment is the explicit metadata-bound deterministic `503`
exception on the same capability-gated path. Before Q, the normal manifest seed
makes exactly one receipt-deadline-fenced request, rejects the temporary
bootstrap marker and continuation, and preserves 15 minutes for its remaining
proofs. The job then proves the immutable graph surface and deploys the exact
one-minute manifest cron. Only then does it qualify the production tuple to Q,
deploy and prove the exact production trusted edge T while Q still cannot serve,
and append terminal C as the final successful authority mutation.
Pending P/Q never overwrites the active C pointer or the retained terminal
ledger, whose hard maximum is eight tuples. Immediately after C, the uncached
exact `/api/release-origin` path requires its distinct production-only proof
capability and proves the committed Pages/T SHA/transaction, proof/Access-token
absence at the candidate, candidate Cache API unavailability, and zero external
I/O. The job then gates production liveness and authenticated readiness through
the trusted public edge, proves the anonymous landing cache reaches a trusted
hit, and reconciles undeclared Pages exposure.

The anonymous landing cache begins only after C and Access and the trusted edge
is its single owner; the candidate proves Cache API unavailable. Its exact
host/SHA/transaction/policy key prevents cross-release reuse; it stores only
exact anonymous `GET /` HTML up to 1 MiB. Per isolate it coalesces one raw match
and origin flight, quarantines a timed-out raw put until settlement, retains only
the newest submitted cacheable pending generation, serves 60 seconds fresh plus
300 seconds stale, and rejects the entry at 360 seconds from origin-flight
start. Publication advances the R2 manifest without changing the key:
busy colos revalidate after 60 seconds and cached low-traffic colos can show old
HTML for at most 360 seconds. There is no purge hook, credential, or API call.
The `public-discovery` tag is future optional operator acceleration only. The
360-second timestamp is a distributed replay bound, not a claim that Cache API
writes are monotonic across isolates.
Confirm the Pages API reports `production_deployments_enabled: false` and
`preview_deployment_setting: "none"` with the verification command in
`docs/development/deployment.md`. Promotion is still incomplete at that point:
enumerate every deployment API page again, retain only the declared canonical
production id, delete or explicitly quarantine every other deployment, and record the final
zero-undeclared inventory. Treat pagination failure, deletion failure,
source-setting drift, an unexpected new deployment, or unavailable quarantine
authority as a failed release gate rather than a warning.

This entire normal path remains externally blocked until the Access apps and
tokens, late transform, hidden domains, protected credentials, live topology/
denial/candidate/cache proofs, and production Convex quota reactivation are
present. Repository tests do not authorize deployment.

## 4. Warm, smoke, and observe

```sh
curl -fsS -H 'Accept: application/json' \
  -H 'x-commons-release-origin-purpose: post-commit-v1' \
  -H "x-commons-release-origin-proof-secret: ${RELEASE_ORIGIN_PROOF_SECRET}" \
  https://commons.email/api/release-origin | \
  jq -e --arg sha "${RELEASE_SHA}" --arg tx "${RELEASE_TRANSACTION_ID}" \
    '.releaseSha == $sha and .transactionId == $tx and
     .originAccessToken == "absent" and .originProofSecret == "absent" and
     .cacheApi == "unavailable" and
     .externalIo == 0'
curl -fsS https://commons.email/ >/dev/null
curl -fsS 'https://commons.email/?view=graph' >/dev/null
curl -fsSI https://commons.email/api/templates
curl -fsS https://commons.email/api/live | jq -e '.status == "ok"'
curl -fsS -H "X-Internal-Secret: ${INTERNAL_API_SECRET}" \
  https://commons.email/api/health | jq -e '.status == "ok"'
```

Materialization generation (`revision:updatedAt`) changes schedule one durably
coalesced producer push; a gate `202` retains and retries that token. The first
request after a location's one-minute revalidation interval
reads the exact global R2 state; it never performs a request-side Convex manifest
refresh. The 60/300/360 cache clock is the correctness boundary. Confirm the homepage and graph are populated, the API advertises its
one-minute browser revalidation policy, `PUBLIC_DISCOVERY_R2` and the external
SQLite gate namespace are bound, and
public-query database I/O stays flat as requests arrive. Record two consecutive
anonymous exact-`/` responses and require the trusted 60/300 cache directives,
`Cache-Tag: public-discovery`, and a nondecreasing bounded `Age`; also prove a
query, cookie, Authorization, Range, non-GET, `Set-Cookie`, or non-200 response
bypasses storage. Remember that this is a named cache inside T: even a hit is a
Workers request and another data center may be cold. Prove the 250-millisecond
lookup deadline, one-second origin abort/quarantine, one raw serialized put plus
newest cacheable pending value, 1 MiB L1 ceiling, and bounded `waitUntil` even
when raw Cache API work never settles. Also prove that two isolates may reorder
shared Cache API writes without extending either origin-start timestamp past
360 seconds. Only then point one-minute process-liveness
monitoring at `/api/live` and five-minute dependency readiness at `/api/health`;
never monitor `/`.

`/api/health` is an authenticated dependency-readiness signal, not a
process-liveness signal:
it deliberately returns `503` when Convex, the discovery manifest, or Atlas is
unavailable, a compact projection is not activated, R2 is unbound, or a probe
exceeds the five-second deadline. Anonymous calls return `401` before any
dependency or cache work, so a distributed request flood cannot multiply
Convex and Atlas traffic across Cloudflare locations. The release workflow
sends `X-Internal-Secret` only through the production custom authority. Staging
proves only the inert candidate boundary described above; production proves
normal readiness through `commons.email` after C.
Direct `pages.dev` runtime probes are forbidden. Normal mode requires
`publicDiscoveryCache.r2Bound:true` and `refreshGateBound:true`; containment
requires `bindingsAbsent:true` with both bound flags false. Use `/api/health` for release gates
and a secret-bearing five-minute readiness monitor; use `/api/live` for process
liveness and do not configure an orchestrator to restart healthy workers from
a readiness response. The Convex probe aborts its underlying HTTP fetch at the
deadline so a dependency slowdown does not accumulate abandoned health requests.

## Rollback

Before terminal C, contain the pending P/Q tuple and restore the captured Pages
and trusted-edge state; do not commit a failed attempt. After terminal C, select
only a previously proven Pages/edge pair whose exact SHA/transaction remains in
the newest-eight retained-C ledger. Restore the hidden Pages candidate first,
then roll the production trusted edge back to its matching captured version,
repeat capability-gated exact `/api/release-origin`, and prove the normal exact
origin contract or the captured containment metadata plus deterministic `503`
exception. Then prove the applicable public authority, release identity, Access
denial, health, and landing-cache headers. The release-qualified key prevents
collision with the failed pair. Cache-tag purge is best-effort acceleration;
transport, permission, response, or Free-limit failure cannot block or establish
recovery.
Never delete or rewind the pending, active, or committed Durable Object state.

Keep the snapshot-safe Convex producer in place. If snapshot content is wrong,
repair the source/code, rerun the atomic rebuild, and warm the new revision.
Normal landing content converges after 60 seconds when healthy and has a
360-second stale failure ceiling without a purge secret or API call. An urgent
explicit namespace cutover may also bump
`CACHE_SCHEMA_VERSION` before redeploying Pages.

Never roll Convex back to the pre-fix functions that scan all published
templates. If backend code must be recovered, forward-deploy a known
snapshot-safe revision and rebuild. A failed rebuild preserves last-known-good
singletons; a logically bad successful rebuild may require restoring the
recorded pre-rebuild backup before publishing a corrected revision.

The detailed incident mechanics and query checks remain in
`docs/ops/CONVEX-PUBLIC-DISCOVERY-IO.md`.
