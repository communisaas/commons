# Cloudflare public dynamic-route cost shield

Status on 2026-07-20: **external production launch gate is unmet and blocks release**.

A read-only live check proved that `commons.email` is an active `Free Website`
zone in account `019d1184e655db74b7589794a2a2a533`. The current deployment token can list
that zone, but the zone `http_ratelimit` entry-point request returns HTTP 403,
Cloudflare error `10000`. It therefore cannot prove the live rule and must not
be described as providing zone-wide public-route throttling.

This is distinct from response caching. `Cache-Control` and
`Cloudflare-CDN-Cache-Control` can govern an eligible CDN response, but they do
not establish that a dynamic SvelteKit Pages Function request is rejected
before Convex or Sharp. The application cache and pre-I/O route limiter are
defense in depth; the zone rule is the pre-Worker abuse boundary.

## Reviewed zero-cost policy

Cloudflare currently includes one rate-limiting rule on the Free plan. Its Free
configuration is limited to path/bot-category matching, an IP counter, and a
10-second counting period. The exact reviewed desired state lives in
`config/cloudflare-public-dynamic-rate-limit.json`:

- one enabled zone `http_ratelimit` rule only;
- ref `commons_public_dynamic_cost_shield_v1`;
- the landing, browse, deliberation, directory, governance, and organization
  entry paths;
- public campaign, donation, event, network, decision-maker, embed,
  accountability, verification, unsubscribe, template/modal, and OG route
  families, including `/s/:slug/og-image`;
- waitlist, organization-invite, and passkey-authentication bootstrap routes,
  which can spend database work before a user has an application session;
- the anonymous campaign/event/decision-maker/debate/template/location/
  position/submission/proof API families enumerated in the policy;
- no verified-bot exemption: recognized crawlers consume the same IP/colo
  bucket as every other caller;
- `cf.colo.id` plus `ip.src` counting;
- 6 requests per 10 seconds;
- Block with the Free plan's 10-second mitigation period; a passed challenge
  cannot reset the counter and reopen origin work;
- `requests_to_origin: false` pinned explicitly, so every matching request is
  counted, including cached traffic, and the rule acts before origin execution.

The Free plan cannot match on HTTP method or authentication state. The rule
therefore applies to every method on an enumerated path after its threshold; it
does not use a broad `/api/*` or `/org/*` prefix that would challenge the
authenticated workspace or v1 API. GET/HEAD reads and POST mutations on the
same reviewed family intentionally consume one bucket. The human-auditable
source is `docs/ops/ANONYMOUS-DYNAMIC-ROUTE-INVENTORY.md`; its canonical
machine-readable examples live in
`config/anonymous-dynamic-route-cost-inventory.json`. The T-owned verifier
requires every protected example to match the policy and requires `/api/live`
and `/api/health` not to match. This regression caught and closed the former
`/api/debates/:id/arguments` gap by covering the complete `/api/debates/`
family. The current scope was built from executable
`+page.server.ts`/`+server.ts` routes:

The bot decision is intentional. A soft launch can still be crawled, and several
enumerated public families are bounded but not yet cache-hit-only. Exempting
`cf.client.bot` would create an unmetered route through the only external cost
fuse and could reproduce a no-human-traffic quota incident. Six admitted
requests per 10 seconds is the accepted launch tradeoff: a normal public journey
can load landing, modal, detail, location, one refresh, and one action inside a
single window; the next request receives a short 10-second block. Reconsider a
bot allowance or higher burst only after measured legitimate traffic proves it
necessary and every exempted route has a hard origin-work budget.

The budget is explicit. `30 × 8,640` permitted 259,200 nominal requests per day
from one steady IP/data-center bucket, already 2.592 times Cloudflare's shared
100,000-request Workers Free daily allowance. The launch value is
`6 × 8,640 = 51,840`, leaving 48,160 nominal requests for other visitors, Pages
Functions, the API edge Worker, and scheduled Workers. This is not a hard daily
cap: Cloudflare documents enforcement delay and per-data-center counters, and
multiple IPs or locations multiply the admitted work. Exhausting Workers Free
returns an availability error rather than creating a usage bill, while admitted
dynamic requests can still consume Convex I/O. The rule is therefore one fuse,
not global quota authority.

| Route class | Why it is in the one rule |
| --- | --- |
| `/`, `/browse` | Dynamic Pages entrypoints; landing/browse use the manifest, Cache API, and R2 shield but still invoke Pages. |
| `/s/*`, `/template-modal/*`, `/og/*` | Public detail and image rendering can reach Convex or Sharp; the nested `/s/*/og-image` path is included by `/s/*`. |
| `/c/*`, `/d/*`, `/e/*`, `/n/*`, `/dm/*`, `/embed/*`, `/accountability/*` | Anonymous civic/campaign/event/network/decision-maker views execute bounded server queries. |
| `/directory`, `/deliberation`, `/governance`, `/org` | Dynamic catalog or entry pages. Governance is authenticated at the app boundary but is included because WAF evaluates before that boundary. |
| `/v/*`, `/verify/*`, `/unsubscribe*` | Public token/hash resolution can otherwise be multiplied into server queries. |
| Enumerated `/api/...` prefixes | Public stats, template, position, location, submission, proof, embed, campaign, event, and decision-maker handlers can reach Convex or an external service. |

Deliberately excluded classes are not claimed to have this WAF protection:
`/api/v1/*` has its own Cloudflare edge limiter plus exact Convex authority;
`/api/live` must remain an I/O-free liveness probe; `/api/health` is an
authenticated release probe; `/api/internal/*`, `/api/org/*`, `/org/*`, and
other account surfaces have explicit authentication/authorization boundaries;
static marketing/assets do not execute the listed Convex/Sharp handlers. This
is a reviewed anonymous cost-route shield, not an app-wide or exact global
quota.

The threshold is an abuse fuse, not an exact global quota. Cloudflare documents
rate counters as per-data-center and eventually applied; a distributed attack
can exceed it. The application must still keep every admitted request bounded.

## Boundary: direct Convex traffic

This shield and every Cloudflare cache described here apply only when the
request traverses Cloudflare. They cannot intercept, admit, or cache a direct
call to the public `*.convex.cloud` origin. The Pages Durable Object budget is
likewise a conservative Pages-dispatch allocation, not a deployment-wide
meter.

Direct-origin closure is enforced at Convex itself. The generated authority
manifest currently classifies all 457 exported public functions exactly once:
254 authenticated/role-gated, 172 server-secret-gated at handler statement one,
5 server-HMAC-gated, and 26 pre-I/O tombstones. The same AST verifier rejects
guard ordering drift, spoofed or unawaited authority helpers, registered
function re-exports/factory aliases, dynamic caller references, secret-source
drift, and any unreviewed browser-direct call. Twelve reviewed browser-direct
operations remain role-gated and cardinality-bounded. Convex's native
actual-database-I/O limit is the final whole-deployment fuse across Pages,
browsers, actions, and schedules.

This separation is intentional: R2/Cache API make ordinary landing-page reads
cheap and revision changes replace their generation, while origin authority
and native limits keep cache bypass from becoming anonymous database work.

This zone rule sees requests whose authority is `commons.email`; it does not
protect a direct `*.communique-site.pages.dev` request. Production therefore has
two independent pre-Environment proofs. The exhaustive account Bulk Redirect in
[`CLOUDFLARE-PAGES-EXPOSURE.md`](./CLOUDFLARE-PAGES-EXPOSURE.md) sends every root,
branch, and hash Pages hostname—without any probe bypass—to the custom authority
before a Pages Function can run. The first application hook separately rejects
an unexpected host before Convex initialization or authentication. The host
hook protects database I/O during redirect drift; only the Bulk Redirect avoids
the Pages invocation and its shared Workers Free allowance.

References:

- <https://developers.cloudflare.com/waf/rate-limiting-rules/>
- <https://developers.cloudflare.com/waf/rate-limiting-rules/parameters/>
- <https://developers.cloudflare.com/waf/rate-limiting-rules/create-api/>
- <https://developers.cloudflare.com/pages/functions/routing/>
- <https://developers.cloudflare.com/pages/functions/pricing/>
- <https://developers.cloudflare.com/workers/platform/limits/>

## Trusted edge, hidden origin, and landing cache

The cost-effective launch topology uses a separate trusted Worker in front of
Pages rather than relying on an unsupported Pages `[cache]` setting or a broad
zone Cache Rule:

| Realm | Public authority | Hidden Pages origin |
| --- | --- | --- |
| Production | `commons-trusted-pages-edge` on `commons.email/*` | `pages-origin.commons.email` |
| Staging qualification | `commons-trusted-pages-edge-staging` on `staging.commons.email/*` | `pages-origin-staging.commons.email` |

The scripts are separate so production's release-authority Durable Object and
staging's purpose-only probe secret never coexist. Both use compatibility date
`2026-07-20`, pin the sole ordered flag `global_fetch_strictly_public`, disable
`workers.dev` and preview URLs, and have exact binding allowlists. The finalized
Pages candidate uses date `2025-04-01` with the exact ordered flags
`nodejs_compat`, `nodejs_als`, `global_fetch_strictly_public`. The Pages project
exposes exactly the two hidden custom domains above; it does not directly own
either public hostname.

Each hidden origin has its own self-hosted Cloudflare Access application and
distinct Service Token. The application reads token JSON only from
`x-commons-pages-origin-access` and has one Service Auth/non-identity policy for
its one token id. There is no Allow, Bypass, Everyone, JWT-only, or shared-token
policy. One enabled `http_request_late_transform` rule matches exactly the two
hidden hosts and removes the custom header after Access. The candidate therefore
receives a validated Access assertion but never the token JSON. Direct requests
with no token, malformed JSON, a wrong id or secret, the other realm's token,
only a JWT/assertion/cookie, or standard client-credential headers must all stop
at Access with `401` or `403` and no candidate proof marker.

The live verifier must enumerate every enabled Access application whose
domain/path overlaps either hidden host, all attached policies, and all
referenced Service Tokens; a convenient expected app is insufficient if a
broader or stale app also matches. It must also prove exact DNS, Pages custom
domains, Pages deployment aliases, Worker routes, and `pages.dev` closure.
`staging.commons.email` is only the staging Worker route; retire every stale
Pages custom domain, branch/deployment alias, or competing Worker route before
qualification.

Cloudflare documents Cache API as unavailable behind Access, and the stock
SvelteKit adapter dereferences it too early for this topology. The trusted
Access-safe adapter makes it optional and reconstructs the public URL before
SvelteKit's CSRF pre-hook. The first app hook independently validates the raw
hidden-origin marker, Access assertion shape, public host, build SHA, and release
transaction, then scrubs transport authority. Production never forwards to that
adapter until its exact release tuple has terminal committed authority.

The named `commons-public-discovery` cache lives only in the production trusted
edge, after that terminal release and origin-access decision. The candidate must
continue to prove Cache API unavailable, so public landing HTML has one cache
owner. It admits only anonymous
exact HTTPS `GET /` with no query, Cookie, Authorization, or Range and stores only
exact `200` HTML without `Set-Cookie`. The trusted edge replaces all origin cache
metadata and emits:

- a key containing public host, source SHA, release transaction, and
  `landing-v1` policy version;
- `Cache-Control: public, max-age=60, stale-while-revalidate=300`;
- equivalent 60/300 CDN directives;
- `Vary: Accept-Encoding`; and
- `Cache-Tag: public-discovery`.

This is the least-expensive safe cache because it removes repeated Pages and
Convex/R2 work without sharing personalized routes or letting candidate headers
define policy. Workers Cache is local to each Cloudflare data center. Within an
isolate, a 1 MiB L1 serves the latest cacheable generation while one cold or
stale origin flight is coalesced. Cache lookup waits at most 250 milliseconds;
one unresolved lookup is quarantined rather than multiplied. An origin flight
waits at most one second, passes an AbortSignal to the hidden-origin fetch, and
remains quarantined until its raw work settles. Every request—including a cache
hit—still counts toward the account-wide 100,000 Workers Free inbound-request
allowance. Cache API has no separate charge, so the cache improves downstream
work but is not a global request quota or attack barrier.

Cache writes are deliberately not retried concurrently. Cache API has no abort
or compare-and-swap primitive, so starting replacement B while timed-out A is
still unresolved could let A finish last and overwrite B. The sole raw writer
is quarantined until settlement; only the newest submitted, cacheable pending
generation is retained, and caller/`waitUntil` observation still ends after one
second. Reservations and uncacheable responses never displace it. This bounds
the isolate to one raw match, one raw origin fetch, one raw put, one pending
generation, and one byte-capped L1 representation per key.

An entry is fresh for 60 seconds. During the next 300 seconds it may be served
while one isolate-coalesced revalidation runs in the background. At trusted age
360 seconds it is unusable and the request must fetch the authorized origin;
repeated origin failure cannot create an unbounded stale response. Publication
advances the R2 manifest without changing the release/policy cache key. A busy
location therefore revalidates after 60 seconds, while a cached low-traffic
location can show pre-publication HTML for at most 360 seconds. This is a
deliberate zero-secret, zero-Cloudflare-API-call launch contract: no publication
purge hook or purge credential exists. The `public-discovery` tag remains only
for a future optional operator optimization; the Free five-purge-per-minute
limit is informative, not launch, freshness, or rollback authority.

Coalescing and write ordering are isolate-local, not data-center-wide. Different
isolates can race against the same local Cache API. The origin-start timestamp
keeps every result unusable after its own 360-second ceiling, but operators must
not interpret this as globally monotonic or linearizable publication.

Do not enable a broad Cache Rule for `/s/:slug`, `/template-modal/:slug`, or
authenticated/private routes. Those responses can contain viewer, recipient,
country, or session-specific state and remain `private, no-store`.

References:

- <https://developers.cloudflare.com/workers/cache/>
- <https://developers.cloudflare.com/workers/cache/purge/>
- <https://developers.cloudflare.com/cloudflare-one/access-controls/service-credentials/service-tokens/>
- <https://developers.cloudflare.com/rules/transform/request-header-modification/>
- <https://developers.cloudflare.com/workers/configuration/compatibility-flags/#global-fetch-strictly-public>

## Close the external gate

1. Create two separate read-only Cloudflare observer tokens. Scope the WAF
   token only to the
   `commons.email` zone with `Zone:Read` and `Zone WAF:Read`. Keep the existing
   account-scoped publication token separate. `Zone WAF:Edit` is needed only by
   the operator who creates or changes the rule; this pre-environment proof
   token must remain read-only. Scope the origin-closure observer to the exact
   account with `Account Filter Lists Read` and the Bulk/Mass URL Redirects read
   permission; it must not publish Pages or edit account rules.
2. In Cloudflare, open **Security > WAF > Rate limiting rules** for
   `commons.email`. The Free plan has one slot. Remove or review any existing
   occupant, then configure the exact policy above. Do not broaden the path,
   exempt verified bots, enable origin-only counting, or substitute a silently
   different action/threshold.
3. Put the WAF read-only token in the protected repository Actions secret
   `PROTECTED_CLOUDFLARE_WAF_READ_TOKEN`. It is intentionally not the
   Environment-scoped publication token: the trusted source-verification job
   must prove WAF state before any GitHub Environment job becomes eligible.
   Put the redirect observer in
   `PROTECTED_CLOUDFLARE_ORIGIN_CLOSURE_READ_TOKEN`. Both are repository-scope
   exceptions only because source verification runs before Environment
   eligibility; neither can mutate external state.
4. Install the exact dedicated redirect list and account first rule from
   `config/cloudflare-pages-dev-origin-closure.json`. Do not exempt `/`,
   `/api/live`, health, refresh, branch aliases, or immutable release URLs.
5. Create exactly two Pages custom domains: `pages-origin.commons.email` and
   `pages-origin-staging.commons.email`. Remove `commons.email` and
   `staging.commons.email` from the Pages domain inventory; their routes belong
   to the two trusted edge Workers. Create two distinct Access Service Tokens
   and two self-hosted Access applications. Set each app's
   `read_service_tokens_from_header` to
   `x-commons-pages-origin-access`, give it exactly one Service Auth policy for
   its own token id, and add no other policy. Never reuse either token across
   realms. Inventory every overlapping Access application/policy/token, DNS
   record, Pages custom/deployment alias, and Worker route; retire any stale
   `staging.commons.email` Pages/branch alias or competing route.
6. Add one enabled zone late-transform rule in
   `http_request_late_transform` with expression
   `(http.host in {"pages-origin.commons.email" "pages-origin-staging.commons.email"})`.
   Its sole header action removes `x-commons-pages-origin-access`. Do not add a
   later rule that restores it.
7. Provision distinct protected secrets
   `PROTECTED_PAGES_ORIGIN_ACCESS_TOKEN_PRODUCTION` and
   `PROTECTED_PAGES_ORIGIN_ACCESS_TOKEN_PREVIEW` as exact JSON objects with only
   `cf-access-client-id` and `cf-access-client-secret`, plus their separate
   non-secret token-id proofs. These values belong only to their corresponding
   trusted Worker deployment jobs. They must never enter Pages, source S,
   artifacts, logs, or responses.
8. Prove exact live state without mutation:

   ```sh
   node scripts/verify-cloudflare-public-dynamic-rate-limit.mjs \
     --policy config/cloudflare-public-dynamic-rate-limit.json \
     --inventory config/anonymous-dynamic-route-cost-inventory.json
   node scripts/verify-cloudflare-pages-dev-origin-closure.mjs \
     --policy config/cloudflare-pages-dev-origin-closure.json
   node scripts/verify-trusted-pages-release-edge.mjs --environment preview
   node scripts/verify-trusted-pages-release-edge.mjs --environment production
   ```

   `CLOUDFLARE_API_TOKEN` must be present in the environment. Success prints the
   exact zone, plan, rule ID, and stable ref. HTTP 403, 404, a second rule,
   disabled state, changed expression, changed counter, origin-only counting,
   or plan drift fails closed. The trusted-edge verifier also runs the
   no-token, malformed, wrong-id, wrong-secret, JWT-only, cookie-only, and
   cross-token denial matrix. It must prove exact Worker routes/bindings, strict
   public fetch, exact compatibility dates/ordered flags, disabled public Worker
   subdomains, only two hidden Pages domains, the complete overlap inventory,
   stale-alias absence, distinct Service Auth policies, and the exact late
   transform. HTTP
   403 from a topology API, a missing credential, or an unproved live denial is
   a launch blocker.
9. Run the exact normal `staging` release for the candidate SHA. The only
   candidate execution proof is the staging trusted edge's purpose-bound
   `/api/release-candidate` exchange: Pages returns empty `204`, proves the
   Access token absent and Cache API unavailable, and the trusted edge returns
   `candidate-fetch-completed`. Then run the manual production release. `main`
   uploads are metadata-only integration artifacts and are not production
   runtime acceptance. The pre-Environment source-verification job invokes the
   same T-owned read-only verifiers for production normal mode; failure there
   occurs before any protected Environment exposes publication credentials and
   before any gate Worker, cron Worker, or Pages mutation.
   Before Q, and again after captured route/version state but before T mutation,
   an existing production edge must reject missing/wrong proof capabilities and
   accept the current retained-window value for the journal tuple. An old edge
   or a different secret blocks promotion.
   Immediately after terminal C, require T's uncached exact
   `GET /api/release-origin` proof with `Accept: application/json` and purpose
   `post-commit-v1`, plus the distinct production-only 32–512 byte
   `x-commons-release-origin-proof-secret` capability that T strips before
   origin forwarding: exact committed SHA/transaction, proof/Access tokens
   absent at the candidate, candidate Cache API unavailable, and external I/O
   zero. Failure restores the retained-C-matching Pages candidate first and its
   captured T version second, then repeats the capability-gated path: normal
   Pages repeats the exact origin proof; containment proves captured metadata
   plus deterministic `503` maintenance. The terminal ledger is not rewound,
   and optional purge failure cannot block or establish rollback.

Emergency containment intentionally skips this external dependency: its job is
to publish a binding-free, zero-I/O 503 artifact even while application
services or WAF proof are unavailable. Preview releases do not claim protection
for the production custom domain and also skip this gate.

As of 2026-07-20, the Access applications/tokens, late transform, hidden-origin
inventory, trusted Worker deployments, and their live denial/candidate/cache
proofs have not all been observed. The production Convex team is also still
quota-disabled. Source and unit tests do not close either external gate; no
normal deployment is authorized until both are attached to the release record.

## Change control

Landing-page content freshness is not coupled to the WAF rule. Content changes
advance revisioned application/R2 coordinates and the trusted landing cache
revalidates after 60 seconds, with the 360-second absolute stale ceiling
described above. No purge secret or API call is part of launch freshness;
`Cache-Tag: public-discovery` is reserved for a future optional operator
optimization. The WAF rule changes only when its reviewed path or abuse budget
changes. Any rule update requires changing the trusted policy, tests,
release-gate blob allowlist, and protected-main workflow commit, then reproving
live state. The workflow binds T to `github.workflow_sha`; there is no mutable
gate-selector variable. Cloudflare dashboard-only drift blocks the next
production normal release.
