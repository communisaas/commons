# Public discovery cache invariants

This document is the correctness and cost contract for
`src/lib/server/public-discovery-cache.ts`. The cache is a small distributed
state machine spanning a Worker isolate, Cloudflare Cache API, and Workers KV.
Local comments explain mechanics; the invariants below decide whether a change
is safe.

## State and authority

| State | Scope | Authority | Mutability |
| --- | --- | --- | --- |
| `memoryCache` and `inFlight` | One Worker isolate | Hot-path optimization only | Mutable and ephemeral |
| Revision-qualified Cache API entry | One Cloudflare cache location | Payload for exactly one revision | Same-revision payload renewal and retry metadata only |
| Cache API LKG pointer | One Cloudflare cache location | Candidate unless it carries a live completed-check lease | Mutable |
| Revision-transition retry marker | One revision in one Cloudflare cache location | Origin retry and global-check lease only; never payload authority | Mutable, revision-qualified |
| Revision-qualified KV entry | All locations for one Convex backend | Global payload candidate for exactly one revision | Same-revision successful renewal only, eight-day TTL |
| Legacy unqualified KV entry | Rollout compatibility only | Never proves the latest revision | Mutable legacy state |

The application cache stores anonymous public projections only. Its keys are
scoped by both the request origin and configured Convex backend, so a preview
origin cannot mutate production's last-known-good state even when both use the
same zero-cost namespace and Convex deployment. Request paths and query strings
must not create new identities in these application-managed layers. The
anonymous projection fixes `recipient_config` to `null` and `recipientEmails`
to an empty array; only `recipient_count` may represent targets. Raw recipient
configuration or addresses in a cache envelope are a security invariant
violation, even if the origin template row is public. Before a list origin load
can enter memory, Cache API, or KV, the consumer requires producer
`projectionVersion:4` and rechecks those exact redaction fields plus a
non-negative integer `recipient_count` on every card. A failed contract check
may fall back only to an already stored v4 last-known-good envelope; it never
persists the rejected payload. The
current single-entrypoint Pages deployment does not source-configure a
front-of-Worker cache. If a route-scoped rule or future public entrypoint enables
one, that outer cache uses its own URL key (including query variants) and is
purged separately by the removal runbook; it is never part of this state
machine's correctness or cost proof.

## Revision order

Only these revision forms participate in global ordering:

- `generation`
- `generation:cold`
- `generation:publishedAt`

All numeric components are unsigned decimal integers. Ordering compares
`generation` first and `publishedAt` second; `cold` sorts below every numeric
publication coordinate. A bare generation has publication coordinate zero.
Comparison is numeric (`BigInt`), never lexical, so generation `10` is newer
than generation `9`.

Callers must not introduce another revision grammar without updating the parser,
selection tests, and this document together.

## Safety invariants

1. **Generation payloads are revision-isolated.** A successful versioned load
   writes its revision-qualified Cache API and KV entries and may advertise that
   revision as a local LKG pointer candidate. The same physical revision key may
   be renewed, and its Cache API copy may carry local retry metadata, but it
   never contains another revision's payload. A late old request can therefore
   update only its old revision entry; the monotonic pointer rules prevent it
   from overwriting a newer generation's selected value. Producers must advance
   the revision coordinate for every payload change; the cache uses that
   coordinate instead of deep-comparing large snapshot bodies.

1a. **List cache fills are producer-versioned and anonymously projected.** The
   Convex schema/functions and a v4 rematerialization must precede the Pages
   consumer. The deploy gate verifies both list variants, and the runtime loader
   repeats the v4 and recipient-redaction checks before returning a value to the
   cache state machine. Revision equality alone cannot authorize an older or
   recipient-bearing payload.

2. **A request-specific hit cannot certify global latest.** An exact KV hit may
   warm only the matching physical Cache API entry. A successful origin load may
   advertise a local pointer candidate for Cache-API-only recovery, but leaves
   `latestRevisionCheckedAt` unset.

3. **Global discovery is strictly bounded.** One latest-generation check issues
   one `KV.list` with `limit: 1000` and never follows a cursor. The returned keys
   are compared using the logical revision order because KV's lexical order is
   not the application order. A healthy exact-revision miss does not run this
   check: it performs one exact KV read and proceeds directly to its origin
   loader. Generation discovery occurs only if that loader fails.

4. **Only a complete immutable scan grants authority.** A pointer receives
   `latestRevisionCheckedAt` only when the one-page scan reports
   `list_complete`, selects a revision-qualified KV envelope, and that revision
   is also the payload being returned. A legacy fallback, list exception,
   missing value, or `list_complete: false` result cannot grant a checked lease.

5. **Overflow and error fail availability-first, not authority-open.** The
   newest known local or partial value may still be served within the seven-day
   LKG window, but it remains uncertified. The pointer and isolate record a
   one-day retry time. Requests in that location do not list again before that
   time, including when no usable payload exists.

6. **A checked pointer cannot be pinned by an old request.** Exact old KV hits do
   not update the pointer. Normal origin writes can replace it only with an
   unchecked candidate. With KV bound, an unchecked or expired pointer must pass
   the bounded global check before it is trusted again.

7. **Failure metadata never enters KV.** Refresh retry state is written only to
   memory or Cache API, never KV. A background refresh may add retry metadata to
   the matching revision-qualified Cache API payload; an authoritative revision
   transition uses its dedicated Cache API marker and never mutates the LKG
   pointer or a KV payload. Origin failure in many locations therefore does not
   cause one KV write per location. KV writes follow successful loads only;
   unchanged healthy values renew at most once per day.

8. **Backoff and coalescing are revision-scoped.** A failed revision must not
   suppress a later revision. Revision-transition failures use a physical Cache
   API marker keyed by the requested revision. It shares the 15-minute origin
   retry across isolates and retains a one-day completed/failed global-check
   lease, while never mutating the LKG pointer. In-flight coalescing and
   `latestRequestedRevision` remain isolate-local cost controls, not
   cross-isolate correctness mechanisms.

9. **Freshness and retention are different leases.** The manifest revalidates in
   one minute, immutable payloads in one day, and LKG data remains eligible for
   seven days. KV retains generation entries for eight days so application-level
   recovery does not lose its backing value first.

## Manifest-outage recovery state machine

| Observation | Action | May certify pointer? |
| --- | --- | --- |
| Usable local value and live completed-check lease | Return local value; no KV operation | Preserve existing lease |
| Usable local value and no KV binding | Return local value | No |
| Unchecked/expired local value with KV binding | Run one bounded global list | Only on complete revision-qualified selection |
| Complete list | Select logical maximum, warm physical edge entry, write checked pointer | Yes, for the selected revision |
| Overflow or list/read error | Serve best usable known value, write daily retry marker | No |
| Live retry marker and no usable local value | Return no LKG without listing | No |
| No value inside seven-day window | Return no LKG | No |

## Authoritative revision-transition state machine

| Observation | Action | Cost effect |
| --- | --- | --- |
| Exact Cache API or KV generation exists | Return it | No list, no origin |
| Exact generation missing and no live retry marker | Call healthy origin directly | No list before origin |
| Origin succeeds | Write revision-qualified payload entries and advertise a local pointer candidate | One successful KV write when renewal policy permits |
| Origin fails and transition check lease is absent/expired | Run one bounded global list, select best usable fallback | At most one list page |
| Origin fails and transition check lease is live | Reuse local fallback | No list |
| Failure has a usable fallback | Write physical fallback plus dedicated requested-revision marker | Cache API only |
| Failure has no usable fallback | Write marker and rethrow | Fresh isolates suppress the same origin failure |
| Same revision during 15-minute retry | Return fallback or reject without origin/list | No origin, list, or KV write |
| Different revision | Use its distinct physical retry key | Never suppressed by an older revision marker |

## Cost boundary

The module guarantees at most one list page per check. After a completed-check
lease becomes visible, the manifest-outage LKG path performs at most one check
per hot logical family per Cache API location per day. Let `F` be the number of
hot logical families and `L` the number of active Cache API locations; the
resulting steady-state bound is `F × L`. Cache API publication is check-then-put,
not an atomic lock: simultaneous first-wave isolates can each check before any
sees the new lease. Therefore `F × L` is not a hard concurrency bound. If at
most `C` isolates race in each location, the first wave can cost up to
`C × F × L`; this module does not itself bound `C`.

An authoritative revision request whose exact KV generation is absent goes to
the origin without listing. Only an origin failure makes one bounded check for a
prior global fallback. Its revision-qualified Cache API marker shares origin
suppression for 15 minutes and the generation-check result for one day across
isolates in that location once the marker is visible. Each distinct failing
revision has its own lease, so `R` distinct failing revisions add a steady-state
`R × F × L` daily-check bound after publication, with the same first-wave `C`
race multiplier. Revisions are internal manifest values rather than request
input; operators must still include failed publication transitions and
first-wave races in quota monitoring.

The Workers KV free allowance is shared with other namespaces, so code alone
cannot guarantee the account-wide 1,000-list allowance for an unbounded number
of active locations. If that allowance is exhausted during a manifest outage, a
cold location with no local LKG can fail closed until KV listing or Convex
recovers. This is an explicit Free-tier availability ceiling, not a distributed
single-flight guarantee.

The one-page scan is also an intentional cardinality ceiling. With eight-day KV
retention and the six-hour rebuild ceiling (normally only the daily cron), each
family stays far below 1,000 live generation keys. If abnormal publication
frequency crosses that threshold, the first lexicographic page is only an
uncertified candidate: the cache serves a usable local LKG when available,
records a daily retry lease, and never follows a cursor on the request path.
Operators must treat repeated overflow warnings as a migration trigger rather
than raising the page count.

A healthy new revision can still produce one exact KV miss and one compact
Convex snapshot query per active location until the successful KV fill becomes
visible. The module deliberately does not emulate a lock with eventually
consistent KV: there is no atomic put-if-absent, and a lock would consume scarce
writes without proving ownership. Convex's cached singleton query prevents this
fill wave from scanning the template corpus. A strict cross-location
single-flight requirement needs a serialized publisher or coordinator outside
this module.

Cross-location coordination would require a stronger primitive than Cache API
or KV's non-transactional mutable keys. Do not add a mutable KV `latest` pointer:
an old isolate can overwrite it after a newer isolate, and it doubles scarce KV
writes. If the one-page generation bound becomes routinely insufficient, use a
new schema with lexically order-preserving immutable revision keys or an
explicit serialized coordinator.

## Change boundary

The landing page, browse page, and public templates API must continue to enter
this state machine through `public-template-queries.ts`; adding another caller,
storage tier, or lease type requires first extracting pure transition decisions
from persistence effects and adding state-sequence/property coverage. Until
then, this module is frozen to correctness, cost, and observability fixes rather
than new cache features.

## Required regression coverage

Changes to this module must retain focused tests for:

- concurrent cold-miss coalescing;
- healthy cross-isolate publication with no generation list;
- revision-scoped cross-isolate transition backoff, including a newer revision
  bypassing an older marker and a cold failure with no fallback;
- 15-minute origin retry without another list inside the daily transition lease;
- logical ordering across `9` to `10` and publication coordinates;
- old/new completion orders in one isolate and across reset modules;
- exact old KV hits not regressing a checked edge pointer;
- daily pointer revalidation without a list on every recovery request;
- a paginated fake returning `list_complete: false`, with one list call, no
  cursor, no false certificate, and a daily retry lease;
- list exceptions producing no false certificate and no retry storm; and
- failed refreshes in independent isolates producing zero additional KV writes.

Any change that weakens one of these assertions requires an explicit
architecture decision and a revised cost calculation before merge.
