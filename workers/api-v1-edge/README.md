# API v1 edge cost shield

This module Worker is a per-location, permissive prefilter for
`commons.email/api/v1/*`. It is not authentication or usage accounting: every
passing request is still authorized and globally rate-limited by the atomic
Convex mutation in `convex/v1api.ts`.

The default Wrangler environment has no production route. Validate both bundles
without changing Cloudflare state:

```sh
npx wrangler deploy --dry-run --config workers/api-v1-edge/wrangler.toml
npx wrangler deploy --dry-run --env production --config workers/api-v1-edge/wrangler.toml
```

Production activation is intentionally separate and must not run before review:

```sh
# MUTATES the live route; gated release operation only.
npx wrangler deploy --env production --config workers/api-v1-edge/wrangler.toml
```

The configuration pins `global_fetch_private_origin`. On the zone route,
`fetch(request)` must reach the existing Pages/origin application without
re-entering this Worker. Do not replace it with `global_fetch_strictly_public`:
that mode makes same-zone fetches traverse public routing and can recurse through
`commons.email/api/v1/*`.

The Worker uses only Rate Limiting bindings and the Workers Cache API. Cache keys
contain a SHA-256 digest of the bearer token, never the plaintext credential.
Tier hints expire within 60 seconds; exact Convex auth still runs on every pass,
so revocation or downgrade is authoritative immediately at the origin.

An uncached token may send at most 10 requests per minute per Cloudflare
location, and a single IP may introduce at most 100 uncached tokens/requests in
that window. The first exact origin response installs the tier or negative hint;
known valid tokens then use their 100/300/1000/3000 plan shield. This deliberately
bounds concurrent rotating-key amplification without imposing the cold IP limit
on an already classified valid integration.

## Cost and correctness boundary

- There is no KV, Durable Object, D1, or R2 state. The Cache API and local rate
  counters are the zero-storage-cost path.
- On the [Workers Free plan](https://developers.cloudflare.com/workers/platform/pricing/),
  requests use the account's included 100,000 Worker requests/day. Reaching that
  ceiling fails at Cloudflare instead of spending unbounded Convex database I/O
  or disabling sibling projects.
- Cloudflare's [Rate Limiting binding](https://developers.cloudflare.com/workers/runtime-apis/bindings/rate-limit/)
  is per-location, permissive, and eventually consistent.
  It is an abuse/cost shield only; the atomic Convex mutation remains the exact
  cross-location per-key counter.
- A valid plan hint lives for at most 60 seconds and a confirmed 401/403 hint
  for at most 10 seconds. Even while a plan hint is cached, every admitted call
  reaches exact origin authentication. Origin responses immediately correct a
  downgrade or revocation before the response is returned.
