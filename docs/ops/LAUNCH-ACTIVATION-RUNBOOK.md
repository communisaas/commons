# Launch Activation Runbook — resolution / freshness / metering arc

Operator sequence that takes the resolve-address arc from **all-noop to live**. The canonical
lever inventory is `docs/design/NOOP-MAP.md` — every step ID below (R0, A1-A3, B1-B5, C1,
D1-D4, E1/E2, F1) is a NOOP-MAP lever, and the ordering follows its Cascade section
(`docs/design/NOOP-MAP.md:68-83`). This document sequences the flips; it changes nothing by
itself.

**Targets:** CF Pages project `communique-site` — `production` branch builds to
`https://commons.email`; prod Convex deployment `quirky-chinchilla-352` (deployed via
`--env-file .env.production`, see step 4).

**Discipline:** every step ends with a fenced Verify command whose success criterion is
observable command output (HTTP code, jq field, `gh run` status, env value). Do not mark a
step done on prose alone.

## Incident prerequisite — PD-05 before PD-00

The shared Convex team is quota-suspended. Before this feature-activation arc,
land the hardened release gate on protected `main`, confirm the workflow binds
T to `github.workflow_sha` and the exact current main head, obtain detached
T/S/A review authority, and publish the zero-I/O containment artifact with:

```bash
gh workflow run deploy.yml --ref main \
  -f branch=production \
  -f ref="$RELEASE_SHA" \
  -f mode=containment
```

The `Production` and `Staging` GitHub Environments must allow deployments only
from protected `main`, disable administrator bypass, and require reviewers.
Revoke/delete repository-level Cloudflare, internal-readiness,
manifest-refresh, and model-reviewer secrets; rotate them and enroll only the
new `PROTECTED_*` control credentials in protected Environments. The containment
run must prove the custom domain's exact SHA and zero dependency calls, report
`preserved=0`, and prove the old immutable Pages URL is blocked. Only then may
an administrator reactivate Convex (PD-00). The B1-before-feature-Pages ordering
below applies to the later normal application release, not to this containment
bootstrap.

PD-00 does not authorize a normal application release. Before billing
reactivation, pause both exact Commons deployments in the Convex dashboard. A
paused deployment queues durable scheduled functions and runs them when
resumed, so team reactivation must occur while both deployments remain paused.
If the current team-disabled state prevents an operator from pausing and
proving both deployments paused, stop and obtain Convex support for an atomic
pause/reactivation sequence; do not reactivate first. While paused, cancel or
explicitly disposition every pending/in-progress `_scheduled_functions` row,
set `CRON_PROFILE=contained`, and push the reviewed SHA to both deployments.
Only after the immutable verifier reports zero registered crons and zero
runnable scheduled functions in both realms may an administrator resume them.

Before leaving
containment, follow the signed operator-capture procedure in
`docs/ops/CONVEX-WORK-BUDGET.md`. The current shared-Free receipt pins a null Orb
subscription, exact binary 1 GiB entitlement, Default team state, all four
projects, and exact dashboard-to-Deployment-API byte reconciliation. It is
diagnostic evidence only: authenticated browser-direct Convex work bypasses the
Pages Durable Object budget, so a point-in-time receipt cannot authorize the
full normal application.

The 2026-07-20 live proof found empty native usage-limit sets, production at
`4.015712767839432` GiB, and preview at `0.08603430446237326` GiB. The checked
1 GiB limits are prospective backstops and cannot be enabled below production's
already accrued usage this month. Both workflow quota proofs request
`full-normal-release` and intentionally reject the checked-in
`blocked-shared-free` authority before Pages upload.

Remain in containment until a protected-main change adds machine-verifiable
authority for a quota-isolated team or an active paid plan without the shared
hard-disable, including limits appropriate to current usage plus reserve. An
upgrade alone does not pass today's verifier. A new same-team deployment, cache
purge, or per-deployment counter reset does not reset team usage. Never put the
broad dashboard bearer, signing private key, or usage-limit write authority in
GitHub.

Three non-mutating repository-scope exceptions are required before Environment
eligibility: `PROTECTED_GITHUB_RELEASE_AUTHORITY_READ_TOKEN` is single-repository
and limited to `Actions:read` plus `Administration:read`, and
`PROTECTED_CLOUDFLARE_WAF_READ_TOKEN` is limited to `Zone:read` plus
`Zone WAF:read` for `commons.email`.
`PROTECTED_CLOUDFLARE_ORIGIN_CLOSURE_READ_TOKEN` is account-scoped only for
`Account Filter Lists Read` and the Bulk/Mass URL Redirects read permission.
Their only purpose is to fail closed on live release-authority, Free-plan WAF,
or exhaustive `pages.dev` origin-closure drift before publication credentials
exist. The redirect must cover every path and query with no release-probe
bypass; containment and normal release probes use the staging/production custom
authorities instead.
The GitHub token must have a finite expiry of at most 90 days. Record its owner
and expiry, rotate it at least seven days early, prove the replacement through
source verification, then revoke the old token; never widen its repository scope
or read-only permissions during rotation. A missing or expired token blocks every
release before Environment eligibility.

### Trusted edge and hidden-origin launch blocker

Normal release also requires this exact Cloudflare topology; none of it is
created merely by merging repository source:

- `commons-trusted-pages-edge` owns `commons.email/*` and
  `commons-trusted-pages-edge-staging` owns `staging.commons.email/*`; both use
  compatibility date `2026-07-20`, only `global_fetch_strictly_public`, and
  expose neither `workers.dev` nor version preview URLs;
- the finalized Pages candidate uses compatibility date `2025-04-01` and exact
  ordered flags `nodejs_compat`, `nodejs_als`,
  `global_fetch_strictly_public`;
- the Pages project has exactly `pages-origin.commons.email` and
  `pages-origin-staging.commons.email` as custom domains, while every direct
  `*.pages.dev` hostname remains closed;
- each hidden origin has a distinct self-hosted Access application, a distinct
  Service Token, and exactly one Service Auth/non-identity policy;
- both Access applications read the exact JSON credential only from
  `x-commons-pages-origin-access`;
- one enabled late-transform rule matches only the two hidden hosts and removes
  that header after Access; and
- production and preview protected Environments contain distinct Access token
  JSON and token-id proofs. No Access token, release-control secret, or Queue
  authority enters Pages. Provider credentials follow the separate ephemeral
  production-only posture below; they never enter preview or persistent Pages
  project defaults.

Inventory every enabled Access application whose domain/path overlaps a hidden
host, every attached policy and referenced Service Token, DNS, Pages custom
domains and deployment aliases, Worker routes, and the full `pages.dev`
closure. Exact equality is required. `staging.commons.email` must be only the
staging Worker route; retire any stale Pages custom domain, branch/deployment
alias, or competing Worker route before qualification.

Run the T-owned topology verifier for both realms. Preserve the denial evidence
for no token, malformed token, wrong id, wrong secret, cross-realm token,
JWT-only headers, and `CF_Authorization` cookie attempts. Every attempt must end
at Access with `401`/`403` and no candidate marker. The preview success path is
also exact: the trusted staging edge accepts only its release probe, the Pages
candidate returns empty `204` with the origin token absent and Cache API
unavailable, and the edge returns `candidate-fetch-completed` for the exact SHA
and transaction.

Release authority uses three states with different lifetimes. One pending
singleton carries provisional P or qualified Q and expires; one active pointer
names the serving terminal C; an append-only terminal-C ledger retains at most
eight exact SHA/transaction tuples for rollback. Arming Q must not overwrite
active or retained C. Before Q, an existing production edge must reject missing
and deterministically wrong proof capabilities with `421`, accept the current
protected value, and prove the retained journal tuple. Normal Pages returns its
exact SHA/transaction and proof/Access absence; containment returns the exact
metadata-bound `503` maintenance exception on the same capability-gated
`/api/release-origin` path. Repeat after capture and before T mutation; any old
edge or different secret blocks promotion. Production handoff ordering is
load-bearing:

1. qualify the new tuple to Q after the candidate and external phase proofs;
2. deploy and live-prove the exact production trusted edge T while it still
   fails closed because Q is not terminal; and
3. append terminal C and advance the active pointer as the final successful
   action.

Immediately after step 3, T must perform the uncached exact
`GET /api/release-origin` handoff proof with `Accept: application/json` and
purpose `post-commit-v1`, authenticated by the independent 32–512 byte
`PROTECTED_RELEASE_ORIGIN_PROOF_SECRET_PRODUCTION` value in
`x-commons-release-origin-proof-secret`. T consumes and strips that header
before Access/origin forwarding. Require `200`, the exact committed
SHA/transaction, proof and Access tokens absent at the candidate, candidate
Cache API unavailable, and external I/O zero. This is the P0 post-C proof;
liveness or ordinary health does not replace it.

If anything fails before step 3, contain the pending tuple and restore the
captured trusted edge/Pages state; never manufacture C. Once C exists, do not
delete, rewrite, or roll back the Durable Object ledger. Restore the previously
proven Pages candidate first, then restore its captured trusted edge version
whose exact tuple remains in retained C, and repeat the exact
`/api/release-origin` proof with the same protected production-only capability.
For normal Pages require the exact tuple and origin-absence contract; for
containment require the captured metadata plus deterministic `503` maintenance
contract. Keep that value stable across the newest-eight retained rollback
window. The release-qualified cache key isolates the failed tuple; a purge is
best-effort acceleration only, and purge failure cannot block or prove
rollback. This keeps the public switch
fail-closed during rollback and never revives the embedding-heavy origin path.

The production landing cache runs only after terminal C and Access and is the
single cache owner; the candidate must prove Cache API unavailable. It stores
only anonymous exact `GET /`, is keyed by public host plus release SHA,
transaction, and policy version, is fresh for 60 seconds, may serve stale while
revalidating for another 300 seconds, and becomes unusable at 360 seconds.
Concurrent cold misses are coalesced until the first cache write settles or the
one-second flight ceiling expires, and stale revalidation is separately
coalesced. The edge overwrites
`X-Commons-Public-Discovery-Cache` with `miss`, `hit`, `stale`, or `bypass`; live
release and recovery proof must observe `hit` with the exact trusted policy and
tag from one bounded probe sequence. Publication advances the R2
manifest without changing that key. The inner manifest cache observes
publication in less than 60 seconds; an outer fill that sees the old coordinate
immediately before that observation can remain eligible for less than 360 more
seconds. The strict manifest-publication-to-last-old-HTML bound is therefore
less than 420 seconds. This zero-secret contract requires no purge credential or API
call. `Cache-Tag: public-discovery` is only a future optional operator
optimization; the Free five-purge-per-minute limit is not launch, freshness, or
rollback authority. Cache hits remain trusted Worker requests and still count
toward the shared 100,000/day Workers Free allowance.

As of 2026-07-20, the required Access configuration, protected secrets, and
live topology/denial/candidate/cache evidence are external blockers. The
production Convex team also remains quota-disabled. Do not run normal
activation or claim these controls live until both blocker classes have exact
operator evidence.

## Paid-provider bounded billing posture

Normal production additionally requires the independently signed exact-account
procedure in `docs/ops/PAID-PROVIDER-POSTURE.md`. Exa and Firecrawl must have
billing and pay-as-you-go enabled; their paid-org draw is bounded by the exact
100,000,000-microusd and 6,000-credit monthly Durable Object ceilings. Gemini
and Groq must remain on their exact Free plans with billing and pay-as-you-go
disabled. Credits, alerts, and delayed provider caps are not authority. The
receipt binds that mixed account posture to the exact release SHA, associated
merged-PR author, dispatcher, four protected credential/account fingerprints,
current usage/reset windows, and an exhaustive empty sibling-consumer inventory.
The signer must be an independently enrolled Ed25519 identity distinct from the
source author and dispatcher.

The Convex provider-egress allowlist is empty and the executable-source scanner
must report zero findings. Any reintroduced Convex provider credential, SDK, or
endpoint invalidates the receipt's empty sibling inventory and blocks release.
The checked-in provider signer root is empty and no live receipt exists, so
independent enrollment and exact live account evidence remain explicit launch
blockers.

The trusted release transaction re-verifies the receipt, marks and authorizes
the Pages mutation, stages the exact four values only in the production project
config, and immediately uploads the immutable deployment. It verifies that
exact deployment captured the four encrypted bindings, then null-deletes them
from both production and preview project defaults using each environment's own
current Wrangler config hash. Bounded reconciliation permits at most one
idempotent cleanup retry. In-process recovery, the outer workflow trap, the
separate recovery workflow, and containment all clean and prove both
environments absent before further deployment. A cancellation or ambiguous
control-plane result that cannot prove absence blocks recovery and normal
release.

## Queue Free approval receipts

Normal release has three separately approved phases: schema-1
`activate-preview`, schema-2 `bootstrap-production`, then schema-1
`activate-production`. Before either activation phase, the old target Pages
producer must be in proven containment and every target Queue must have zero
advisory backlog. The same immutable Pages artifact id, canonical digest, exact
source SHA, and trusted-gate SHA cross all phases. A staging rebuild with the
same SHA is not the production artifact.

Capture each phase receipt on the operator workstation. The observer token must
have exactly Account Analytics Read, Billing Read, Queues Read, and Workers
Scripts Read. The capture deletes the token environment entry before its first
await, performs two complete account observations at least 15 minutes apart,
requires every analytics window to be settled by at least 15 minutes, and writes
one new mode-0600 canonical file with exclusive creation. It never writes the
bearer into the receipt. The Ed25519 private key also remains operator-local:

```bash
umask 077
export CLOUDFLARE_QUEUE_OBSERVER_API_TOKEN
node scripts/capture-cloudflare-queue-free-envelope.mjs \
  --operator-principal "$OPERATOR_PRINCIPAL" \
  --output "$RECEIPT_JSON" \
  --release-phase activate-preview \
  --source-sha "$RELEASE_SHA"

node scripts/sign-cloudflare-queue-free-envelope.mjs \
  --attestation "$RECEIPT_JSON" \
  --signature "$RECEIPT_SIGNATURE" \
  --signing-key "$QUEUE_SIGNING_KEY" \
  --allowed-signers .github/cloudflare-queue-allowed-signers
```

Do not capture `activate-production` immediately after preview. Production
preflight must first complete, both schema-2 observations must be newer than its
handoff, and the workflow must finish the common warm/cold bootstrap handoff.
Only then capture schema-1 `activate-production`; both of its observations must
be newer than the bootstrap handoff. Do not reuse any preview or bootstrap
receipt. Schema-1 receipts are valid for at most 30 minutes, may be verified no
more than 27 minutes after capture, and cannot cross UTC midnight. The currently
checked-in Queue allowed-signers file has no enrolled operator, so this is an
external launch gate until a dedicated public key/principal is reviewed on
protected main.

Production's signed baseline is exact, not “empty enough”: one current primary
consumer with its captured ID and exact work budget, no producer on either
Queue, zero primary and DLQ backlog, active/unpaused source and DLQ delivery,
zero delivery delay, and 24-hour retention. Bootstrap first redeploys that
consumer with the exact release SHA and transaction bindings and proves no
Queue/config delta before a cold path may attach its one temporary producer.
Warm and cold paths must both return this dormant topology. Normal production
activation's first external Queue mutation then pauses/normalizes delivery under
the schema-1 receipt. Preview enters and remains paused during its corresponding
preparation.

The receipt and signature are static protected Environment secrets only as a
transport mechanism; they are not renewable standing authority. A value whose
observations predate the required handoff, whose capture/expiry window is stale,
or whose tuple differs fails closed. At each of the two production approval
seams, pause for the operator to capture, sign, and replace the relevant
protected attestation/signature values (and the bootstrap principal slot at the
first seam) before approving the waiting Environment job.

The signed account baseline must be no more than 2,500 already-observed Queue
billable operations. Each new message-attempt reservation projects `9` operations
onto its send day, `8` onto the next UTC day, and `2` onto the second; each realm
day caps at 2,500. Two realms therefore project at most 5,000, and the exact
nominal worst case is `5,000 + 2,500 = 7,500`, leaving 2,500 of the 10,000 Free
operations. This is not reserved capacity: the analytics dataset is operational
signal rather than invoice truth, at-least-once delivery has no finite duplicate
bound, and sibling account traffic remains outside the gate. Any inventory,
subscription, producer/consumer identity, Queue setting, backlog, pagination, or
account-aggregate drift stops activation.

The OG consumer is configured with an exact 100 ms CPU cap. Cold-process proof
measured 26.5–28.1 ms and warm average about 1.75 ms. Cloudflare applies the
Queue-consumer CPU class (30-second default, configurable up to five minutes),
not the general HTTP/Cron row; nevertheless, the phase must prove the exact live
100 ms setting and exact-SHA artifact before producer binding.

Within each activation Environment phase, capture gate, Queue, consumer, and
Pages prior state before mutation and persist a mode-0600 journal. Every
attempted flag is written before its external command. Verify all credentialless prerequisites
first, then re-verify the signature, receipt age, complete account authority,
deployment posture, and active preview sibling last immediately before each
mutation. The command deadline must leave recovery time inside the phase job.
An outer `always()` recovery uses the journal even after cancellation/timeout:
forward-contain attempted Pages, pause delivery, restore the exact captured
Queue consumer ID plus settings and gate state where ownership still matches,
and prove the result. No live
receipt, post-mutation inventory, or rollback evidence exists yet; do not treat
the source contract as activation proof.

Publication readiness has its own monotonic incident clock. The first trusted R2
acquisition that sees a newer target but cannot finish JSON+PNG publication sets
`publicationLag.startedAt`. Retry, superseding content, and checkpoint rearm do
not reset it. Previously served authority is eligible through exactly 45 minutes
and fails closed immediately afterward; `REPAIR_EXHAUSTED` or another terminal
producer code fails authenticated `/api/health` immediately even inside that
window. Only a complete successful publication clears the state. Health obtains
this proof with one exact R2 GET and no LIST/origin fallback.

If a Queue handoff reaches `REPAIR_EXHAUSTED`, follow
`docs/ops/PUBLIC-TEMPLATE-OG-REARM.md`. The operator tool defaults to a local
dry-run, requires the exact checkpoint ETag, coordinate digest, and SHA-256 of
the incident evidence, then performs at most one `If-Match` write plus exact
readback. It changes only `enqueuedOffset`, `enqueuedAt`, and `enqueueAttempts`.
Rearm neither clears terminal health nor bypasses the 9/8/2 daily ledger; trigger
the normal authenticated producer once and require successful publication.

### Cold production corpus: receipt and automated bootstrap

This is a source-defined launch procedure, not evidence that the external
Cloudflare or Convex controls are live. Do not approve it while the production
Convex team is quota-disabled or any Access, Queue, R2, signer, protected-secret,
or recovery prerequisite above remains unproved.

The `bootstrap-production-discovery` job runs after preview qualification and
production preflight, before normal production Queue activation. Its first
action is a production-only, read-only R2 completion proof. The proof makes six
fixed-key GETs—two each for manifest, checkpoint, and inventory—and two exact
HEADs per checkpoint coordinate. It performs no LIST, write, Convex call, or
Cloudflare control-plane mutation.

Interpret its result exactly:

- exit zero with `proof:"production-bootstrap-complete"` skips only the cold
  temporary-producer/seed branch and requires the temporary route and script
  already absent;
- only an error beginning
  `PUBLIC_DISCOVERY_BOOTSTRAP_INCOMPLETE:` authorizes the cold branch; and
- `PUBLIC_DISCOVERY_BOOTSTRAP_CONFIGURATION_ERROR:`, Access denial,
  `NoSuchBucket`, network/timeout failure, and every other error stop the run.

Never reinterpret an operational failure as an incomplete classification merely
to enter the cold branch.

For every warm or cold classification, capture a separate schema-2 receipt only
after production preflight has completed and the workflow has an exact run id
and attempt. Both complete observations must be newer than the recorded
preflight completion time. This is not either normal `activate-preview` or
`activate-production` receipt. Set `RELEASE_TRANSACTION_ID` to
`<run-id>-<run-attempt>` and run on the operator workstation:

```bash
umask 077
export RELEASE_TRANSACTION_ID="${DEPLOY_RUN_ID}-${DEPLOY_RUN_ATTEMPT}"
export BOOTSTRAP_RECEIPT_JSON="$PWD/cloudflare-queue-bootstrap-production.json"
export BOOTSTRAP_RECEIPT_SIGNATURE="$PWD/cloudflare-queue-bootstrap-production.sig"
export CLOUDFLARE_QUEUE_OBSERVER_API_TOKEN

node scripts/capture-cloudflare-queue-free-envelope.mjs \
  --operator-principal "$OPERATOR_PRINCIPAL" \
  --output "$BOOTSTRAP_RECEIPT_JSON" \
  --release-phase bootstrap-production \
  --source-sha "$RELEASE_SHA" \
  --transaction-id "$RELEASE_TRANSACTION_ID"

node scripts/sign-cloudflare-queue-free-envelope.mjs \
  --attestation "$BOOTSTRAP_RECEIPT_JSON" \
  --signature "$BOOTSTRAP_RECEIPT_SIGNATURE" \
  --signing-key "$QUEUE_SIGNING_KEY" \
  --allowed-signers .github/cloudflare-queue-allowed-signers
```

Capture must begin after preflight but early enough for the 15-minute observation
separation plus the complete proof window to stay inside one UTC accounting day.
The receipt expires after at most 75 minutes and is unacceptable more than 72
minutes after capture. Before approving `bootstrap-production-discovery`, replace
the base64-encoded canonical file, base64-encoded detached signature, and exact
principal in these protected `Production` Environment secrets using stdin, not
command arguments:

- `PROTECTED_CLOUDFLARE_QUEUE_FREE_BOOTSTRAP_PRODUCTION_ATTESTATION_B64`;
- `PROTECTED_CLOUDFLARE_QUEUE_FREE_BOOTSTRAP_PRODUCTION_SIGNATURE_B64`; and
- `PROTECTED_CLOUDFLARE_QUEUE_FREE_BOOTSTRAP_PRODUCTION_OPERATOR_PRINCIPAL`.

These static secret slots carry one receipt; they do not extend it. Reusing the
prior run's value or approving before the two post-preflight observations causes
the workflow to fail closed.

The workflow enforces this transaction without an operator-side mutation:

1. Verify the signed receipt with at least 4,320 seconds remaining, bind it to
   the exact source SHA, transaction, and principal, and require both observations
   to follow production preflight.
2. Prove the signed dormant production baseline: the existing exact primary
   consumer ID and work budget; no primary or DLQ producer; zero backlog;
   active/unpaused source and DLQ; zero delivery delay; and exact 24-hour
   retention.
3. Redeploy the finalized OG consumer with exact `PUBLIC_RELEASE_SHA` and
   `PUBLIC_RELEASE_TRANSACTION_ID` bindings. Even if Wrangler's response is
   lost or nonzero, reread the live deployment and accept only the exact version,
   bindings, consumer ID, work budget, unpaused delivery, unchanged Queue
   settings, and producerless zero-backlog topology.
4. If and only if classification was cold, write private append-only recovery
   custody at stage `intent`, then arm a separate source/transaction/UUID
   authority. Protocol permits at most 60 minutes; the workflow uses 59 minutes.
5. Within that cold branch, deploy the consensus-digested finalized Pages
   `_worker.js` as `commons-public-discovery-bootstrap` on only
   `pages-origin.commons.email/api/internal/public-discovery-manifest-refresh`.
   The route is exact and non-wildcard: query strings and path variants do not
   match. There is no `workers.dev` or version-preview exposure.
6. Record the exact deployed version, then prove at least 3,960 seconds remain
   and that the only signed account-wide Queue-authority delta is this one
   transient producer on the existing production primary Queue. No Queue, DLQ,
   consumer identity, setting, backlog, or unrelated producer may change.
7. Prove Access denies the anonymous request before Worker execution. Then send
   an Access-admitted canary with a derived invalid refresh credential and
   require application `401` plus bootstrap boundary `v1` before any gate,
   Convex, R2, or Queue work.
8. Run at most 25 typed seed/continuation requests inside the absolute authority
   deadline, always retaining ten minutes. Only `/complete-bootstrap` may
   certify the exact ready generation.
9. Use at most the next five minutes to poll only exact R2 keys and match the
   seed generation, completed SQLite authority, stable manifest, completed
   checkpoint, exact inventory, and every revision-qualified JSON/PNG pair.
   Retain the final five minutes to remove and prove the route absent first,
   then remove and prove the script absent second.
10. For both warm and cold classifications, require the same terminal oracle
    with at least 180 seconds remaining: exact transaction-bound consumer and
    work budget, active/unpaused source and DLQ, exact settings, no producer, and
    zero backlog. Repeat the stable read-only R2 completion proof. Only then may
    the job emit `bootstrap_complete:true` and allow normal production activation.

The job's `always()` cleanup contains an armed-but-incomplete authority and uses
the bootstrap custody chain even before the normal schema-v4 journal exists.
Hard cancellation or runner loss is handled independently by
`public-template-og-release-recovery.yml`; it restores any owned outer
Pages/trusted-edge/manifest-cron state first, then deletes an exact owned
bootstrap route before its script. Do not run Wrangler delete commands by hand.
A mismatched or superseding route/script is preserved and the recovery fails
closed for investigation. See
[`PUBLIC-RELEASE-RECOVERY.md`](./PUBLIC-RELEASE-RECOVERY.md).

A failed attempt may safely leave the newly proved exact dormant consumer: it
has no producer, no backlog, and no work to execute. This is not a successful
handoff. Retry reclassifies the corpus and overwrites the consumer code/version
for its new exact release tuple before any producer can be attached.

After bootstrap, normal activation still requires its own fresh schema-1
`activate-production` receipt. Both settled observations must be later than the
successful bootstrap handoff; update the schema-1 attestation, signature, and
principal protected secret slots before approving the second production seam.
A stale bootstrap-era schema-1 value fails closed. Production activation's first
Queue mutation pauses/normalizes the active dormant baseline; preview remains
paused throughout its preparation. After the Queue/Pages activation transaction and
before production terminal C, the qualification job's normal manifest seed
makes exactly one request and reserves 15 minutes of that receipt for the
remaining graph, cron, Q, and commit proofs. It rejects a bootstrap marker and
any continuation. If content changes between bootstrap certification and this
one-shot proof and the bounded request can publish and prove the new generation,
the release may continue. If that change instead returns continuation,
generation skew, or another incomplete state, let the release abort; a new exact
transaction reclassifies and certifies the new generation instead of stretching
the old authority.

For later content changes, writers advance immutable revision coordinates and
the producer publishes the complete new set before advancing the manifest. An
incomplete producer leaves the prior generation eligible for no more than 45
minutes; retries cannot restart that clock. Because that lag clock is present
in cached authority, prior authority expires without another R2 observation.
For an authored change, at most 60 seconds of scheduling plus at most five
minutes of ordinary admission, 45 minutes of prior authority, and less than 360
seconds for the last outer fill put the conservative writer-to-last-old-HTML
failure bound strictly below 57 minutes. Once a healthy manifest
advances, the separate less-than-60-second inner observation plus less than 360
seconds of outer eligibility yields a strict publication-to-last-old-HTML bound
below 420 seconds. Open tabs update on navigation or reload. A purge is optional
acceleration, never freshness or release authority.

**Three orderings are load-bearing (hard requirements, not suggestions):**

1. **B4 before B1** — the drain cron freezes the secret at push time (`convex/crons.ts:573`).
2. **B1 (Convex) before the CF Pages deploy** — otherwise B3 bricks all address verification.
3. **D4/D1/B5 before or with C1 — never C1 alone** — otherwise D2/D3 silently write off revenue.

---

## Step 1 — R0: push, PR, merge (both repos)

The arc is committed locally but unpushed on one machine: commons branch
`p0-resolution-build` carries 7 commits ahead of `main` and voter-protocol branch
`p0-freshness-producers` carries 4. What remains of R0 is push → PR → merge. **A human lands
the push/merge** — commons `main` requires the `test` CI check before merge. All
voter-protocol commands use **npm** (never pnpm). Note the voter-protocol root
`package.json` has no `test:unit` script — the shadow-atlas suite runs from
`packages/shadow-atlas` (`cd packages/shadow-atlas && npm run test:unit`).

Merging alone activates nothing in prod (NOOP-MAP "Honest surface": prod
`/api/v1/resolve-address` stays a plain 404 until the deploys below).

Verify: both PRs merged with green required checks:

```bash
gh pr list --repo communisaas/commons --state merged --head p0-resolution-build \
  --json number,mergedAt,title
gh pr list --repo communisaas/voter-protocol --state merged --head p0-freshness-producers \
  --json number,mergedAt,title
```

Expected: each command prints one merged PR with a non-null `mergedAt`.

## Step 2 — B2: unblock the Convex CLI (`.env.local` env-family conflict)

`.env.local` currently sets **both** the self-hosted family (`CONVEX_SELF_HOSTED_URL` /
`CONVEX_SELF_HOSTED_ADMIN_KEY`, `.env.local:47-48`) and the cloud family
(`CONVEX_DEPLOYMENT`, `.env.local:80`). With both present the Convex CLI refuses to target a
cloud deployment — no prod deploy happens at all. Comment out one family; for the prod cloud
deploy in step 4, comment out the `CONVEX_SELF_HOSTED_*` pair.

Verify: exactly one family remains active:

```bash
grep -nE '^(CONVEX_SELF_HOSTED_(URL|ADMIN_KEY)|CONVEX_DEPLOYMENT)=' .env.local
```

Expected: only `CONVEX_DEPLOYMENT=` prints (the two `CONVEX_SELF_HOSTED_*` lines are
commented out), or vice versa for local work — never both families at once.

## Step 3 — B4: set `INTERNAL_API_SECRET` on prod Convex BEFORE any deploy

`convex/crons.ts:573` arms the drain cron with
`{ _secret: process.env.INTERNAL_API_SECRET ?? "" }` — the value is **serialized at push
time**. Deploying while it is unset freezes `""` into the cron arm; every tick then throws
Unauthorized (visible only in Convex logs) until the NEXT deploy. Set it before step 4 and
before any future C1 redeploy.

Requirements: at least 32 bytes, **byte-identical** to the `INTERNAL_API_SECRET` already set
on the CF Pages project (read it from the CF dashboard; rotate both together if rotating).

```bash
read -rs SECRET   # paste the CF Pages INTERNAL_API_SECRET value; no echo, no shell history
npx convex env set INTERNAL_API_SECRET "$SECRET" --env-file .env.production
```

Verify: length and cross-system equality by hash (never print the plaintext):

```bash
npx convex env get INTERNAL_API_SECRET --env-file .env.production | tr -d '\n' | wc -c
npx convex env get INTERNAL_API_SECRET --env-file .env.production | tr -d '\n' | shasum -a 256
printf '%s' "$SECRET" | shasum -a 256
```

Expected: first command prints >= 32; the two hashes are identical.

## Step 4 — B1: deploy Convex (metering functions + tables)

Ships the metering functions and the `usageRecords` / `usagePeriodTotals` tables to prod.
Until this lands, every resolve returns the typed 502 `METERING_UNAVAILABLE`
(`src/routes/api/v1/resolve-address/+server.ts:142`) — fail-closed, never a silent free
resolve.

```bash
npx convex deploy --env-file .env.production
```

**Never run bare `npx convex deploy -y`** — it silently fails to reach the prod deployment
in this repo. `--env-file .env.production` is the only deploy form verified to land on prod.

Verify: metering functions exist on the prod deployment:

```bash
npx convex function-spec --env-file .env.production | grep -c 'metering'
```

Expected: a count greater than 0 (the `metering.*` function identifiers are listed).

## Step 4b — B1c: migrate and ACTIVATE the discovery source plane

```text
+------------------------------------------------------------------------------+
| THE STEP THAT WAS MISSING. Deploying Convex ships the readers; it does NOT   |
| build the projections they read. Every public discovery reader FAILS CLOSED  |
| until activation — by design, not by fault. Skip this and the site serves    |
| its shell with no data, /api/templates returns 500, and /api/health reports  |
| convex:false while the Convex deployment itself answers 200. That exact      |
| state was observed on prod, and it is what steps 4 and 5 alone produce.      |
+------------------------------------------------------------------------------+
```

Run the canonical command chain in
[`docs/development/deployment.md` § migrations](../development/deployment.md) — it is the
single maintained copy and is not restated here. This step owns the ORDERING and the GATES;
that document owns the commands.

Order, and why it is this order:

1. `migratePublicDiscoveryManifestAuthority`, then poll
   `publicDiscoveryManifestAuthorityOperatorStatus`. The manifest authority is what every
   other reader resolves its revision against, so nothing downstream is meaningful until it
   is ready.
2. `migratePublicDiscoverySourcePage` in a loop, polling `publicDiscoverySourceMigrationStatus`
   until `status` is `"migrated"`. **The first response does not prove completion** — these
   are self-paging jobs that return before they finish.
3. `activatePublicDiscoverySourcePlane`, then re-poll to `"ready"`.
4. `templateListProjectionMigrationStatus` → `activateTemplateListProjection` → re-poll
   `"ready"`.

Gates — every one is a stop condition, not a warning:

- `publicDiscoverySourceMigrationStatus` must reach `status: "migrated"` with `rejected: 0`
  and `sourcesWritten == eligible`. A non-zero `rejected` means rows the reader will refuse;
  activating over them ships a partial corpus.
- `status: "blocked"` is a STOP. Diagnose the coded row or page-budget failure and use
  `{"restart":true}` only after correcting it. Do not re-run the migration hoping it clears.
- A row is not eligible for activation unless **both** projections validate — the
  at-most-16-KiB public card and the separate at-most-48-KiB detail/send row. The detail
  reader never falls back to the canonical embedding-bearing template.
- `templateListProjectionMigrationStatus` must reach `"migrated"` with `failureCode` and
  `failureTemplateId` null and `scanned == projected`, then `"ready"` after activation.

Never pass `_secret` to these through `npx convex run` arguments: they are server-only
surfaces and the value would land in process arguments and shell history. The migration and
status functions above are internal and take no secret; the versioned discovery queries do,
and are not called by hand.

Verify — the deployed function set actually contains the activation machinery:

```bash
npx convex function-spec --env-file .env.production \
  | grep -cE 'publicDiscoverySourceMigrationStatus|activatePublicDiscoverySourcePlane|publicDiscoveryManifestAuthorityStatus'
```

Expected: `3`. A `0` means the deploy in step 4 did not land — on 2026-08-18 prod carried
744 functions against 907 in the branch, with none of this machinery present, and that is
precisely the shape of a deploy that never reached prod.

## Step 5 — CF Pages deploy (promote `production`) — B3 ordering constraint

```text
+------------------------------------------------------------------------------+
| ORDERING CONSTRAINT (B3): the Convex deploy MUST precede this CF Pages       |
| deploy. The new Pages code sends four provenance keys unconditionally on     |
| every address verification (src/lib/server/ground/ground-service.ts:224-227: |
| boundaryAsOf, officialsAsOf, tigerVintage, resolutionConfidence). Old prod   |
| Convex rejects unknown args — those validator fields exist only in the new   |
| deploy (convex/users.ts:624-627). Ship Pages first and ALL address           |
| verification bricks with 500s — fail-loud and total, for every user, until   |
| Convex catches up. Complete steps 3-4 first, then this step.                 |
+------------------------------------------------------------------------------+
```

Do not promote through native Pages Git integration or direct Wrangler. Native
production and preview uploads remain disabled. After the Convex and trusted
edge/Access gates above are closed, dispatch the protected-main workflow for the
exact reviewed SHA:

```bash
gh workflow run deploy.yml --ref main \
  -f branch=production \
  -f ref="$RELEASE_SHA" \
  -f mode=normal
```

The workflow uploads the inert candidate only behind the hidden Pages origin,
proves it through the distinct staging edge, then performs the production
Q → trusted-edge T → terminal-C handoff. A branch push alone is not deployment
evidence.

Verify: new route live (auth-gated, not missing) and address verification not bricked:

```bash
curl -s -o /dev/null -w '%{http_code}\n' -X POST https://commons.email/api/v1/resolve-address \
  -H 'content-type: application/json' -d '{}'
curl -s -o /dev/null -w '%{http_code}\n' -X POST https://commons.email/api/identity/verify-address \
  -H 'content-type: application/json' -d '{}'
```

Expected: first prints `401` (API key required — NOT `404` route-missing, NOT `500`);
second prints `401` (authentication required, `+server.ts:329` — NOT `500`). Then complete
**one real end-to-end address verification in a browser as a signed-in user** and confirm a
credential is issued, not a 500 — that is the actual B3 evidence; the curls only prove the
routes are deployed.

## Step 6 — A2: refresh the officials clock, publish the source snapshot

The chunked build stamps `officialsGenerated` from the officials DB's `ingestion_log`
(voter-protocol `packages/shadow-atlas/scripts/build-chunked-mapping.ts:208-245`, stamp at
`:285`). The live
DB's only success row is months old — dispatching A1 without a fresh ingest debuts the
"fresh clocks" feature showing stale officials. Run in voter-protocol (npm):

```bash
cd packages/shadow-atlas
npm run ingest:legislators
npm run publish:source -- --tiger-vintage TIGER2024   # substitute the real current TIGER vintage
```

Notes: `publish:source` requires `CLOUDFLARE_API_TOKEN` / `CLOUDFLARE_ACCOUNT_ID` in the
environment, and a non-dry run **refuses** any vintage label not matching `TIGER20YY`
(`scripts/publish-source.ts:571` calls `resolveTigerVintage`, which throws at
`src/distribution/snapshots/tiger-vintage.ts:32`). **Record the sha256 the publish emits** —
it is the `expected_manifest_sha256` input for step 7.

Verify: the ingestion log carries a success row from this run:

```bash
sqlite3 officials.db "SELECT run_at FROM ingestion_log WHERE source='congress-legislators' AND status='success' ORDER BY run_at DESC LIMIT 1"
```

Expected: the timestamp of the ingest just performed (today), not a months-old date.

## Step 7 — A1: operator publish dispatch (quarterly workflow)

Dispatch `shadow-atlas-quarterly.yml` with a real vintage and the manifest SHA from step 6.
Confirm the Ed25519 manifest-signing public key pin is configured in the repo before
dispatching (the manifest-resolution step prefers Ed25519 signature verification when the
public key is set — `shadow-atlas-quarterly.yml:154-155`, enforcement at `:267-289`); never
bypass verification with `allow_unverified`.

This dispatch also builds and publishes the **address index** (the `build-address-index`
job, `shadow-atlas-quarterly.yml:742-814`, feeds `validate-build` → `upload-r2` — the
atlas-native geocoder's data plane; see step 10). Its vintage inputs default to `unknown`,
which **fails the build by design** — set real values: `nad_vintage` (NAD release compile
date, `YYYY-MM-DD`), `addrfeat_vintage` (`TIGER20YY`). `nad_url` defaults to the current DOT
NAD text-release zip (empty skips NAD and builds a ranges-only index); `address_states`
empty means all states.

```bash
gh workflow run shadow-atlas-quarterly.yml --repo communisaas/voter-protocol \
  -f tiger_vintage=TIGER2024 \
  -f expected_manifest_sha256=<sha256 emitted by publish:source in step 6> \
  -f nad_vintage=<YYYY-MM-DD of the NAD release> \
  -f addrfeat_vintage=TIGER2025
```

Verify: run green, then the published manifest actually carries both freshness clocks
(their absence in the previous live manifest is exactly what this publish fixes):

```bash
gh run list --repo communisaas/voter-protocol \
  --workflow=shadow-atlas-quarterly.yml --limit 1 \
  --json status,conclusion,displayTitle
```

Expected: `"status": "completed"`, `"conclusion": "success"`. Then, with the versioned
`ATLAS_BASE_URL` printed in the run summary:

```bash
curl -s "https://atlas.commons.email/v<YYYYMMDD>/US/manifest.json" | jq '{tigerVintage, officialsGenerated}'
```

Expected: `tigerVintage` = the dispatched `TIGER20YY` value and `officialsGenerated` = the
step-6 ingest timestamp — neither null nor missing. Missing clocks mean every resolution is
clamped to 0.4 confidence with "boundary vintage unknown"
(`src/lib/core/shadow-atlas/redraw-guard.ts:88-104`).

## Step 8 — A3: point prod at the new atlas version (env pins)

When step 7 was dispatched with `push_cids=true` (the default,
`shadow-atlas-quarterly.yml:47-53`), the workflow's `push-cids` job (`:958`, config-push
step `:995-1040`) **pushes `ATLAS_BASE_URL`, `VITE_ATLAS_BASE_URL`,
`EXPECTED_CELL_MAP_ROOT`, and `EXPECTED_CELL_MAP_DEPTH` to the CF Pages project**
and prints all four to the run summary.

> **⚠️ WRANGLER.TOML IS THE SOURCE OF TRUTH — the API push alone is NOT durable.**
> Because commons' `wrangler.toml` carries `pages_build_output_dir`, every git
> deploy of the site REWRITES the project's plain-text env vars to exactly its
> `[vars]` block — the push-cids API update (and any dashboard edit) is silently
> reverted by the NEXT production deploy. After every republish, land the four
> new values in `wrangler.toml [vars]` via a commit (this is what makes the pin
> survive). Learned 2026-07: a deploy deleted both `EXPECTED_CELL_MAP_*` pins
> and degraded /api/health + snapshot validation until they were restored.

Hand-edit the CF Pages env vars only as a stopgap if the job failed; a CF Pages env
change takes effect on the next deployment.

This is a **recurring ritual**: every future republish must re-point the version-pinned path
(`/vYYYYMMDD`) and re-pin root/depth, or clients silently stay on the old atlas.

Verify: prod health reports the new pinned atlas:

```bash
# Exact reviewed frontend SHA deployed by deploy.yml; never use a branch name.
RELEASE_SHA=<40-character-lowercase-git-sha>
curl --fail-with-body -sS \
  -H "X-Internal-Secret: $INTERNAL_API_SECRET" \
  https://commons.email/api/health | \
  jq -e --arg sha "$RELEASE_SHA" '.status == "ok" and .release.sha == $sha and .atlas.status == "ok" and .sessionCookieAuthority.keysIsolated == true'
```

Expected: `"baseUrl"` ends in the new `/vYYYYMMDD`, and `configured`, `rootPinned`,
`depthPinned`, `manifest`, `districtIndex` are all `true` with `"status": "ok"`.

---

Ordering note for steps 9-10: NOOP-MAP's cascade lists F1 ninth and E1/E2 tenth. The two are
order-independent (no dependency edge between them); this runbook puts schedule enablement
first because it needs only the step-1 merge, while the geocoder activation (step 10) is
verified against the atlas published by the step-7 dispatch.

## Step 9 — E1 + E2: schedule enablement

**E1 — quarterly staleness alarm.** The cron `0 2 1 1,4,7,10 *`
(`shadow-atlas-quarterly.yml:97`) registers only once the workflow is on the default branch
(after step 1). Its semantics, verbatim from the workflow's own comment (`yml:88-96`): on a
`schedule` event the `inputs` context is empty, so `tiger_vintage` resolves to `'unknown'`
and the build **fails fast before any manifest is written** — "This is intentional and
fail-closed: a silent stale publish is impossible. A RED quarterly run means 'time to
republish' ... The schedule is the reminder; the dispatch is the publish."

**A red scheduled run is the republish alarm working as designed. Do not silence it, do not
normalize it as CI noise** — answer it by running steps 6-8. Also note GitHub auto-disables
schedules after 60 days without repo activity; re-enable from the Actions UI if that
happens.

**E2 — boundary change-check.** Daily cron `0 6 * * *` (`shadow-atlas-change-check.yml:34`).
The R2 round-trip steps skip cleanly when `R2_ACCESS_KEY_ID` is absent
(`shadow-atlas-change-check.yml:84,104,126`) — but without the R2 repo secrets every run
starts from a fresh DB and reports every source as "new" (meaningless signal). Confirm the
R2 secrets are present; the first real run seeds the durable detection DB.

Verify: workflows registered and runnable, R2 secrets present:

```bash
gh workflow list --repo communisaas/voter-protocol
gh secret list --repo communisaas/voter-protocol | grep -i 'R2'
gh run list --repo communisaas/voter-protocol \
  --workflow=shadow-atlas-change-check.yml --limit 1 --json status,conclusion
```

Expected: both shadow-atlas workflows listed `active`; R2 secret names listed; the latest
change-check run `completed`/`success` (a fresh-DB first run reporting everything new is
expected exactly once).

## Step 10 — F1: atlas-native geocoder activation (rides the step-7 publish)

**There is nothing to provision.** The geocoder is atlas-native and already committed: the
resolver normalizes the street line, fetches the ZIP5 chunk from our own R2 artifacts, and
runs the deterministic match ladder entirely in-process
(`src/lib/core/shadow-atlas/geocoder.ts`; `resolveAddress` calls it at
`src/lib/core/shadow-atlas/client.ts:1236`, provenance source `atlas-address-index` at
`:1309`). The founder decision rejected the self-hosted-Nominatim bridge outright
(`docs/design/GEOCODER-OPTIONS.md:273` — atlas-native straight, 2026-07-03); `NOMINATIM_URL`
has ZERO references anywhere in committed `src/` + `convex/`. The raw user address never
leaves infrastructure we control — there is no external geocoding call to configure. (The
unrelated `/api/location/search` autocomplete proxy is a separate, open founder decision —
see NOOP-MAP.)

**The activation lever is the step-7 quarterly dispatch**: its `build-address-index` job
publishes the ZIP5 address chunks, `normalization.json`, `chunk-index.json`, and the
manifest's `addressIndex` section + `addressIndexGenerated` third clock into the versioned
atlas that step 8 pins. Until that manifest section exists at the pinned `ATLAS_BASE_URL`,
every resolve fails closed as the typed 502 `RESOLVE_FAILED` (`+server.ts:235`, via the
store's `AddressIndexSchemaError` "index not yet published" guard, `ipfs-store.ts:942-947`)
— the dependency is the step-7 publish + step-8 pin, **not** any step-10 provisioning.
(`RATE_LIMITER_ALLOW_MEMORY=1` must still be present on the CF Pages env — on a fresh env
without it every resolve is a typed 502 `RATE_LIMITER_UNAVAILABLE`, `+server.ts:77-83`.)

Verify 10a — the live pinned manifest carries the address index:

```bash
curl -s "https://atlas.commons.email/v<YYYYMMDD>/US/manifest.json" \
  | jq '{schemaVersion: .addressIndex.schemaVersion,
         addressIndexGenerated,
         normTableSha256: .addressIndex.normTable.sha256,
         totalChunks: .addressIndex.totalChunks}'
```

Expected: `schemaVersion` is exactly `1`, `addressIndexGenerated` is a non-null ISO-8601
timestamp, `normTableSha256` is a 64-char hex sha256, `totalChunks` > 0.

Verify 10b — publish the DE/RI/DC sample, then rerun the §6 source-population gate against
it. The sample tree exists in voter-protocol
(`packages/shadow-atlas/sample/address-index/`) with the upload procedure in its README
(`sample/address-index/README.md` — `upload-to-r2.ts --directory sample --prefix sample`,
including the known false-FAILURE exit of the script's final URL probe). **The documented
sample URL `https://atlas.commons.email/sample/address-index/v1/…` currently returns 404**
— the upload is a real operator step, not already done. Then, in commons:

```bash
SAMPLE_ATLAS_BASE_URL=https://atlas.commons.email/sample/address-index/v1 \
  npx vitest run tests/integration/shadow-atlas/geocoder-sample-gate.test.ts
```

Expected: the suite RUNS (it skips loudly when `SAMPLE_ATLAS_BASE_URL` is unset — a skipped
gate never counts as a pass) and all six §6 checks pass against the real published artifact.

Verify 10c — one real end-to-end resolve:

```bash
curl -s -X POST https://commons.email/api/v1/resolve-address \
  -H "Authorization: Bearer $API_KEY" -H 'content-type: application/json' \
  -d '{"street":"1600 Pennsylvania Ave NW","city":"Washington","state":"DC","zip":"20500"}' | jq '.'
```

Expected: a resolved district payload with `provenance.source: "atlas-address-index"` and
both `asOf` clocks — not `{"error":{"code":"RESOLVE_FAILED"}}`.

---

## Appendix — customer-close: billing activation as ONE atomic unit (D4 → D1+B5 → C1)

Run this appendix only when the first paying resolve customer closes, and run it **as one
unit, in this order**. Nothing in it is a defect before then — the noop provider is the
correct pre-customer posture.

```text
+------------------------------------------------------------------------------+
| SILENT REVENUE WRITE-OFF (D2/D3): the noop drain PERMANENTLY consumes usage  |
| rows. The noop path stamps reportedToProvider: true with a noop:<requestId>  |
| event id (convex/metering.ts:394 via the markReported stamp at :243-246),    |
| and the drain only ever selects rows still at undefined                      |
| (convex/metering.ts:209). Flip C1 while D1 is still noop (D2) — or half-flip |
| Convex=noop / Pages=stripe (D3) — and every accumulated usage row is stamped |
| reported without ever reaching Stripe: revenue written off silently and      |
| permanently, with no error anywhere. The Stripe drain rejects noop: ids      |
| (metering.ts:339) but nothing guards the reverse direction.                  |
|                                                                              |
| D BEFORE / WITH C. NEVER C ALONE.                                            |
+------------------------------------------------------------------------------+
```

The quota gate is unaffected by C1 timing — the per-period counter is written
in-transaction at record time (`convex/metering.ts:93-110`), so the 402 at plan cap holds
whether or not the drain cron is running. Only _reporting to the provider_ is at stake here.

### D4 — provision Stripe Meters + `STRIPE_SECRET_KEY`

In the Stripe dashboard, create a billing Meter whose **event name equals each billable
meter enum value** — `resolve_address` (`convex/schema.ts:2250-2251`, on `usageRecords`);
the adapter posts
meter events under exactly that name
(`src/lib/server/billing/providers/stripe-adapter.ts:31-32`, `event_name: r.meter`).
Flipping D1 without Meters means every meter-event create rejects, rows stay unreported, and
the only signal is console noise — infinite retry. Set `STRIPE_SECRET_KEY` on the CF Pages
project (the SvelteKit internal endpoint owns the Stripe SDK).

Verify: the Meters exist under the same key the app will use:

```bash
curl -s https://api.stripe.com/v1/billing/meters -u "$STRIPE_SECRET_KEY:" | jq -r '.data[].event_name'
```

Expected: output includes `resolve_address`.

### D1 + B5 — flip `BILLING_PROVIDER=stripe` on BOTH sides; set `PUBLIC_BASE_URL` on Convex

The provider is selected independently on each side: CF Pages reads it lazily in
`getBillingProvider()` (`src/lib/server/billing/providers/index.ts:16-21`); Convex reads it
inline in `providerName()` (`convex/metering.ts:376-378`). Flip **both** — a half-flip is
the D3 write-off above.

B5: the Convex Stripe-drain branch defaults `PUBLIC_BASE_URL` to `https://commons.email`
(`convex/metering.ts:288`). Any stripe-flipped non-prod Convex deployment would therefore
POST **prod's** report-usage endpoint with the wrong secret (a 403 loop — fail-closed but
cross-env). Set `PUBLIC_BASE_URL` explicitly on every Convex deployment that ever flips to
stripe.

```bash
npx convex env set BILLING_PROVIDER stripe --env-file .env.production
npx convex env set PUBLIC_BASE_URL https://commons.email --env-file .env.production
```

Then set `BILLING_PROVIDER=stripe` on the CF Pages project env (dashboard) in the same
sitting — remember Pages env changes apply on the next deployment.

Verify: both Convex values readable, Pages side confirmed before proceeding:

```bash
npx convex env get BILLING_PROVIDER --env-file .env.production
npx convex env get PUBLIC_BASE_URL --env-file .env.production
```

Expected: `stripe` and `https://commons.email`. For the Pages side, confirm the project env
var reads `stripe` in the CF dashboard — do not start C1 until both sides show stripe.

### C1 — freeze `CRON_PROFILE=contained` and prove zero runnable scheduled work

On the shared Free team, `operational` is not launch-authorized. The quota is
shared across sibling projects and one sibling can exhaust it after any
point-in-time headroom check. Both Commons backends must therefore deploy with
the fail-closed `contained` profile, which registers no cron jobs. Merely
setting the variable is insufficient: profile selection is frozen when
`convex/crons.ts` is deployed.

Create one unique operator correlation identifier such as
`convex-recovery-2026-07-20-a`; this is the recovery epoch for the entire
pause/reactivate/contain/resume sequence. Immediately before applying either
pause, record the epoch's millisecond lower bound, then pause both exact
deployments before billing reactivation. Restrict resume authority to the
recorded change custodian.

The paused proof uses two distinct least-privilege keys per deployment: a
`deployment:data:view` key for backend/cron/active-work state and a separate
`deployment:auditLog:view` key for pause history. Before reactivation, run the
state-only proof below. It is valid while the provider reports
`system=disabled|suspended` or `usageLimit=disabled`, but it still requires the
independent `user=paused` control at both state reads, a provider pause event at
or after the epoch lower bound, and zero later unpause/running events:

```bash
export CONVEX_RECOVERY_EPOCH='convex-recovery-2026-07-20-a'
# Run this immediately before applying the two dashboard pauses.
export CONVEX_RECOVERY_EPOCH_MIN_MS="$(node -p 'Date.now()')"
# Apply both exact deployment pauses now; then run the proof below.
PROTECTED_CONVEX_PRODUCTION_CRON_DATA_VIEW_DEPLOY_KEY='<prod key>' \
PROTECTED_CONVEX_PREVIEW_CRON_DATA_VIEW_DEPLOY_KEY='<preview key>' \
PROTECTED_CONVEX_PRODUCTION_CRON_AUDIT_LOG_VIEW_DEPLOY_KEY='<prod audit key>' \
PROTECTED_CONVEX_PREVIEW_CRON_AUDIT_LOG_VIEW_DEPLOY_KEY='<preview audit key>' \
  node scripts/verify-convex-contained-cron-deployments.mjs \
    --environment all \
    --scope state \
    --expected-state paused \
    --recovery-epoch "$CONVEX_RECOVERY_EPOCH" \
    --recovery-epoch-min-ms "$CONVEX_RECOVERY_EPOCH_MIN_MS"
```

`operatorRecoveryEpoch` prevents evidence from different attempts being mixed;
`pauseEpochAudit` is the provider-backed history proof. The audit query
pages `pause_deployment`, `unpause_deployment`, and legacy
`change_deployment_state` events from the recorded lower bound through a pinned
`fenceStartMs`. It fails after four 25-result pages rather than turning recovery
into another unbounded read. After the second paused-state read, one overlapping
tail query starts at `fenceStartMs`, has no upper bound, and must finish in its
single 25-result page with zero resume transitions. This closes the separate-page
snapshot race through the tail query's transaction. A missing pause, any resume,
budget/pagination failure, or retention-clamped-away pause fails closed. The
tail transaction is the machine proof endpoint; preserve exclusive
resume-authority custody after it. Any later custody gap or uncertainty
invalidates the epoch: pause again, issue a new identifier/lower bound, and
restart C1. If the disabled team cannot accept the independent user pause, audit
history is unavailable, or authority cannot be controlled, Convex support must
provide an atomic pause/reactivation control before proceeding.

Keep both deployments paused. Before the authorized Convex deployment, set
`CRON_PROFILE=contained` on the exact production and preview backends and
dry-run the release source. Use the normal protected Convex deployment
authority for the actual push; the read-only keys below cannot deploy, cancel,
pause, resume, or mutate anything. Convex documents that code pushes and
dashboard edits remain available while paused.

Before canceling anything, capture the active Schedules/Functions inventory in
the recovery-epoch bundle without attaching arguments or other secrets.
Exhaustively review every upcoming scheduled function. A pending function may
be canceled or receive an explicit reviewed disposition. An `inProgress`
scheduled action needs execution-specific completion evidence or Convex support
disposition: canceling it changes the scheduler row to `canceled`, but does not
stop an action that has already begun executing. A canceled row is therefore
not quiescence evidence for an action first observed `inProgress`. Do not resume
a deployment to drain the queue; queued work runs on resume.

The machine proof below calls Convex's indexed active-work query with page size
one. The index includes only pending/in-progress rows, so an empty final page
proves zero runnable rows and one returned row fails immediately. The provider
may include inline legacy arguments or an `argsId` in that single returned row;
the verifier neither inspects nor logs the row, never scans retained completion
history, and never dereferences `argsId`.

For the live proof, mint four deployment-scoped deploy keys in Convex's
deployment settings. Grant the data pair **only** `deployment:data:view` and the
distinct audit pair **only** `deployment:auditLog:view`:

- `PROTECTED_CONVEX_PRODUCTION_CRON_DATA_VIEW_DEPLOY_KEY` with exact prefix
  `prod:quirky-chinchilla-352|`;
- `PROTECTED_CONVEX_PREVIEW_CRON_DATA_VIEW_DEPLOY_KEY` with exact prefix
  `dev:outstanding-firefly-831|` (the release realm is named `preview`, but the
  persistent Convex deployment's actual type is `dev`).
- `PROTECTED_CONVEX_PRODUCTION_CRON_AUDIT_LOG_VIEW_DEPLOY_KEY` with exact prefix
  `prod:quirky-chinchilla-352|`;
- `PROTECTED_CONVEX_PREVIEW_CRON_AUDIT_LOG_VIEW_DEPLOY_KEY` with exact prefix
  `dev:outstanding-firefly-831|`.

These are Starter-compatible deployment service tokens, not custom-role team
tokens. The verifier can prove the key's deployment type/name prefix and that
it can read the private cron inventory, but the provider does not let a key
introspect its own `allowedActions`. Preserve each reviewed dashboard enrollment
record as the authority for its one-action grant, and never reuse the same token
for the data and audit roles. The normal Pages workflow receives only the data
keys; audit keys exist solely for the controlled paused recovery proof.

Run the same immutable verifier used by the normal release job:

```bash
PROTECTED_CONVEX_PRODUCTION_CRON_DATA_VIEW_DEPLOY_KEY='<prod key>' \
PROTECTED_CONVEX_PREVIEW_CRON_DATA_VIEW_DEPLOY_KEY='<preview key>' \
PROTECTED_CONVEX_PRODUCTION_CRON_AUDIT_LOG_VIEW_DEPLOY_KEY='<prod audit key>' \
PROTECTED_CONVEX_PREVIEW_CRON_AUDIT_LOG_VIEW_DEPLOY_KEY='<preview audit key>' \
  node scripts/verify-convex-contained-cron-deployments.mjs \
    --environment all \
    --scope containment \
    --expected-state paused \
    --recovery-epoch "$CONVEX_RECOVERY_EPOCH" \
    --recovery-epoch-min-ms "$CONVEX_RECOVERY_EPOCH_MIN_MS"
```

Expected: both `registeredCronJobs` and `runnableScheduledFunctions` values are
exactly `0`; `proofScope` is `containment`; both `backendStateFence` observations
record `user=paused`; and `operatorRecoveryEpoch` matches the epoch bundle. The
`pauseEpochAudit` for each realm must include at least one pause event and exactly
zero resume events. The provider system/usage fields are recorded exactly and
may change from disabled to active during reactivation, but neither user-state
observation may be resumed. The old live state is 18 production jobs and 16
preview jobs, and the queued scheduler inventory has not yet been captured, so
C1 remains blocked until the authorized paused contained redeploy, initial
inventory, and exhaustive queue disposition land.

Resume each deployment only after that proof and the pause-epoch custody/audit
evidence succeed for both exact realms. Run one bounded service ping, then repeat
the containment proof with `--expected-state running` (all provider state fields
must be `none`; the same optional `--recovery-epoch` may correlate the output).
The normal Pages release repeats the running proof immediately before upload and
after resolving the uploaded deployment URL. A nonproduction release receives
only the preview read key; only the Production GitHub Environment can materialize
the production read key and it re-proves both realms. The verifier disables
Convex client logging and never prints either key or the returned active-work row.

Contained mode intentionally leaves the `drain-usage` cron absent. Do not claim
automated Stripe backlog draining or a fully operational billing plane in this
posture. Activating `essential` requires quota isolation or a paid authority
without the shared hard-disable failure mode; activating `operational` then
also requires the billing, delivery, analytics, and producer gates in
`docs/ops/CRON-PROFILES.md`.
