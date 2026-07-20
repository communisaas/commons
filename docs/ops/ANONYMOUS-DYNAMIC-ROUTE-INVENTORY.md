# Anonymous dynamic-route cost inventory

This is the launch inventory for browser-callable routes that can execute
Convex, Cache API/R2, an action, or image rendering without first proving an
authenticated application role. It is the independent input to the single
Cloudflare Free-plan WAF/rate-limit expression; response cache headers are not
counted as a pre-Worker defense unless a live outer cache rule is separately
proven.

The regression-consumable companion is
`config/anonymous-dynamic-route-cost-inventory.json`. It contains one concrete
path for every WAF-required row below plus the two probe bypasses. The trusted
Cloudflare verifier fails if any protected example falls outside the exact
policy or either probe falls inside it. Because the Free rule cannot match HTTP
method, every method on a reviewed path intentionally shares the same external
bucket even when the table calls out the business method that motivated the row.

`application shield` below means a check that runs before the named origin
work. The shared in-process limiter is per isolate when Redis is absent and is
only defense in depth. The live Cloudflare rule is the cross-isolate launch
boundary.

| Route and method | Anonymous origin work | Cache / bound | Application shield | Launch classification |
| --- | --- | --- | --- | --- |
| `GET /` | Reads the producer-published manifest and list/optional graph payload | Memory + Cache API + exact R2 objects; deployed anonymous misses do not fall through to Convex | No general GET throttle | Dynamic Worker route; include in WAF |
| `GET /api/templates` | Same public-discovery read plane | Same bounded list cache | Existing API route rule does not throttle GET | Dynamic API; include in WAF |
| `POST /api/waitlist` | Validates and hashes one address, then performs one secret-gated mutation | Not cacheable | Route-local body and email bounds; global work reservation occurs immediately before Convex | Public account bootstrap; include in WAF |
| `POST /api/auth/passkey/authenticate` | Reads compact authentication material and creates/consumes a short-lived ceremony before session creation | Not cacheable | Fresh server HMAC proofs at Convex plus the global work budget; no feature flag is a cost boundary | Public account bootstrap; include the complete `/api/auth/passkey/` family in WAF |
| `GET/HEAD /s/:slug` | Reads the current manifest, its bounded immutable page inventory, and the exact revision-qualified page artifact published by the authenticated producer. Anonymous memory/Cache/R2 misses never call Convex or R2 LIST | Valid cold slug: exact GETs only. A random slug stops after the inventory. The artifact is an exhaustive public projection; authenticated viewer overlays are separate indexed reads and force `private, no-store` | Exact canonical slug rejection and 6/IP/10s before auth/Convex | FND-40 protected; include in WAF |
| `GET/HEAD /template-modal/:slug` | Reuses the same immutable inventory and page artifact; no request-path producer | Same exact-read plane; anonymous misses have zero Convex, LIST, writes, or fallback | Same FND-40 exact shield | FND-40 protected; include in WAF |
| `GET /s/:slug/og-image` (`HEAD` is 405) | Reads current manifest and bounded inventory, then one exact producer-published PNG; no render, Convex, origin, write, or LIST | Revision-qualified Cache API/R2 binary; missing or corrupt exact objects fail closed with 503 | Same FND-40 exact shield; malformed slug rejected before storage | FND-40 protected; include in WAF |
| `GET /s/:slug/debate/:debateId` | Cached parent detail plus one paginated public-debate Convex query | Parent detail cache only; debate result is not application-cached | Not covered by the exact FND-40 matcher | Include broader `/s/` family in WAF |
| `GET /deliberation` | One bounded `debates.listPublic` Convex query | No application cache | None | Include in WAF |
| `GET /accountability/:id` | One public decision-maker/receipt Convex query | No application cache | None | Include in WAF |
| `GET /c/:slug` | One public campaign Convex query | No application cache | GET has no application throttle; form submission is 10/IP/campaign/min before action work | Include page family in WAF |
| `GET /embed/campaign/:slug` | One public campaign Convex query | No application cache | GET has no application throttle; form submission is 10/IP/campaign/min | Include embed family in WAF |
| `GET /og/campaign/:id` | One public campaign Convex query and dynamic SVG construction | Only response `s-maxage=3600`; no explicit pre-origin Cache API lookup is proven | None | Include OG family in WAF |
| `GET /d/:campaignId` | One public campaign Convex query when fundraising is enabled | No application cache | None | Include in WAF while feature is enabled or staged |
| `POST /api/d/:campaignId/checkout` | Public campaign query plus donation action/external work | Not cacheable | Global `/api/d/` 10/IP/min | Include mutating API family in WAF policy as applicable |
| `GET /api/d/:campaignId/stats` | One public stats Convex query | No application cache | Global `/api/d/` 10/IP/min, plus local 30/IP/min | Include in WAF |
| `GET /e/:id` | One public event Convex query when events are enabled | No application cache | None | Include in WAF while feature is enabled or staged |
| `GET /api/e/:id/stats` | One public stats Convex query on a cache miss | 30-second memory + Cache API single flight | Global `/api/e/` 10/IP/min, plus local 30/IP/min | Include in WAF |
| `POST /api/e/:id/rsvp`, `POST /api/e/:id/checkin` | Public action/mutation; check-in also queries event state | Not cacheable | Global `/api/e/` 10/IP/min and route-local checks | Include mutating API family in WAF policy as applicable |
| `GET /n/:slug` | One secret-gated public-charter Convex query | Response advertises shared-cache headers, but there is no explicit application Cache API lookup | None | Include in WAF; do not claim a pre-Worker hit without live proof |
| `GET /directory` without cursor | One bounded organization query on a cache miss | First page: 60-second memory + Cache API single flight | Cursor length bound; no GET throttle | Include in WAF |
| `GET /directory?cursor=...` | One bounded paginated organization query per opaque cursor | Continuations intentionally bypass Cache API to avoid attacker-created keys | Cursor capped at 2,048 characters; no GET throttle | Include in WAF |
| `GET /governance` | Anonymous request returns 401 before the governance query; a supplied session cookie is validated by the auth hook | No public cache | Authentication gate, but no pre-auth GET throttle | Include if the WAF expression covers all dynamic browse surfaces; not an anonymous business-data query |
| `GET/POST /org/invite/:token` | Resolves an opaque invitation; authenticated acceptance then mutates membership | No application cache | Token bounds, authentication for acceptance, and global work reservation before each Convex operation | Public token bootstrap; include in WAF |
| `GET /dm/:id`, `GET /dm/:id/scorecard` | One public profile or scorecard Convex query | No application cache | None | Include `/dm/` family in WAF |
| `GET /api/dm/:id/scorecard` | One public scorecard Convex query | No application cache or cache header | None | Include API family in WAF |
| `GET /api/dm/scorecard/compare?ids=...` | One comparison query for up to five IDs | No application cache | Count capped at five; no GET throttle | Include API family in WAF |
| `GET /api/embed/scorecard/:id` | One scorecard query and, with `?org=`, one branding query | No application cache | None | Include embed API family in WAF |
| `GET /api/c/:slug/stats` | One campaign-stats Convex query | Browser cache header for 10 seconds; no explicit Cache API lookup | Global `/api/c/` 30/IP/min and route-local 30/IP/min | Include in WAF |
| `GET /api/positions/count/:templateId` | One aggregate Convex query | No application cache | No route rule for GET | Include public-stats family in WAF |
| `GET /api/positions/engagement-by-district/:templateId` | One aggregate Convex query whose key can vary by `userDistrict` | No application cache | No route rule for GET | Include public-stats family in WAF |
| `GET /api/debates/by-template/:templateId`, `GET /api/debates/:id/arguments` | One bounded/paginated Convex query | No application cache | Global `/api/debates/` 20/IP-or-user/min plus route-local 60/IP/min | Include API family in WAF |
| `GET /api/debates/:id/stream` | Authenticated SSE initialization and five-second Convex polling | Long-lived, not cacheable | Requires a session; global `/api/debates/` limit runs after auth | Do not expose as an anonymous polling bypass; retain WAF coverage |
| `GET /api/live` | No external I/O | Intentionally uncached liveness response | Exempt | WAF bypass candidate for the approved monitor only |
| `GET /api/health` | Secret-gated dependency/readiness work | Not public | Rejects missing secret before dependencies | Do not use as a public monitor |

## Direct Convex origin authority

Cloudflare sees requests to the Pages and custom-domain surfaces above. It does
not see or cache a request sent directly to the deployment's `*.convex.cloud`
origin. A Pages WAF rule, Cache API hit, R2 artifact, or Durable Object admission
therefore cannot be the authority boundary for an exported Convex
`query`, `mutation`, or `action`.

`config/convex-public-function-authority.json` is the exhaustive generated
origin-surface manifest. The 2026-07-20 inventory contains 457 public exports:
254 authenticate or prove a role before unknown/material work, 172 verify the
server-only internal secret as handler statement one, 5 verify a reviewed
server HMAC before work, and 26 throw a pre-I/O retirement error. No export is
accepted merely because it is intended for a server caller. `servicePing` is an
internal query rather than a public exception. The verifier also proves all 192
server-secret SvelteKit call sites obtain the secret from the one canonical
server module; the secret is never a browser cache key or browser credential.

Twelve intentional browser-direct operations remain. They require application
identity/role authority and each has a named hard work bound in the manifest
(cursor/row/byte or fixed-record limits). They are outside the Pages-only
Durable Object budget, so Convex's native actual-I/O limit remains the
deployment-wide backstop. Any new public export, stale export, changed guard,
dynamic function reference, untrusted secret source, or unreviewed browser call
fails `npm run check:convex-authority`.

## Static / no-origin exceptions in this scope

- `src/routes/embed/+layout.server.ts` only returns `{ user: null }`; its child
  campaign and scorecard routes above are dynamic.
- The anonymous branch of `src/routes/+layout.server.ts` performs no membership
  query. Supplying a session cookie can make the auth hook and layout query
  Convex before a route load, which is why the external WAF remains necessary.
- Static assets under SvelteKit's asset paths are not part of this inventory and
  must be excluded from a scarce dynamic-route rate-limit rule.

## Remaining application-level cost gaps

The external zone WAF can bound custom-authority request volume, but it does not
see direct Pages hostnames or the direct Convex origin, and it does not turn the
Convex rows above into cache hits. The highest-value next application cache
candidates are campaign/embed GETs, decision-maker/scorecard GETs, public
position API aggregates, network charters, and the nested public debate page.
Each needs its own exhaustive public projection, cardinality bound,
mutation/freshness contract, and negative-cache policy before being admitted to
Cache API; response headers alone are not sufficient proof.

Every `communique-site.pages.dev` root, branch, and deployment hostname is a
separate execution surface unless the account edge closes it. Launch therefore
requires the exhaustive, zero-bypass Bulk Redirect desired state in
`config/cloudflare-pages-dev-origin-closure.json`. It redirects every path and
query to `commons.email` before Pages invocation. Release probes use
`staging.commons.email` and `commons.email`; they never create a public
`pages.dev` exception. The first application hook also rejects any unexpected
host before Convex initialization, but that 421 is data-I/O protection during
redirect drift, not a way to avoid the shared Workers request count.
