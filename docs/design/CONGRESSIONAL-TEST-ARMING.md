# Runbook — Arm congressional delivery to the Senate TEST sandbox

Congressional CWC delivery is code-complete. The one in-repo code gap (the `/resolve`
service the delivery action depends on) is now closed: `src/routes/api/tee/resolve/+server.ts`.
What remains is **operator configuration** — two flags on two surfaces, the Senate sandbox
creds, and a secret. This arms the **Senate `testing-messages` sandbox only** (a no-op inbox);
the House path stays disarmed (no House sandbox exists — House = a live send).

> Safety invariants this runbook preserves: zero `house.gov` requests, the Senate `messages`
> (live) prefix is refused unless `CWC_PRODUCTION=true`, and the prod bundle stays
> `CONGRESSIONAL=false`. A misconfigured prefix fails safe to `testing-messages`.

## 0. Topology — who routes what (read first)

- **Senate = DIRECT, no proxy, no GCP.** `deliverToCongress` POSTs straight to
  `CWC_API_BASE_URL` = `https://soapbox.senate.gov/api` with `CWC_API_KEY` (registered as
  "Communiqué PBC" in SOAPBox). Per `.env.example`: *"Senate submissions work without proxy."*
  So the Senate sandbox needs **only** the CWC key + base URL — `GCP_PROXY_URL` is irrelevant to it.
- **House = the proxy subdomain.** `GCP_PROXY_URL=https://house.communi.email` (cert migrating to
  **`house.commons.email`**) is a GCE instance (`34.171.151.252`) IP-whitelisted with the House.
  It's named `GCP_PROXY_URL` only for where it's *hosted*; the endpoint is the commons subdomain.
  Required because the House CWC API needs a whitelisted source IP. **No House sandbox exists** —
  setting this arms a LIVE send. Leave unset for Senate-only testing.

> **The creds are NOT missing — they're on the wrong surface.** `CWC_API_KEY`, `CWC_API_BASE_URL`,
> `GCP_PROXY_URL`, etc. live in the local `.env`/`.env.local` (which feed the SvelteKit dev server).
> But every CWC/launch var is read in `convex/submissions.ts` — i.e. on the **Convex deployment**
> env, which (dev + prod) has only `INTERNAL_API_SECRET`. Arming = copying the needed vars from the
> dotenv onto the Convex deployment via `npx convex env set`, NOT obtaining new creds.

> **Status (2026-06-17):** the **dev** Convex deployment is armed for the Senate sandbox —
> `CWC_API_BASE_URL`, `CWC_API_KEY`, `CONGRESSIONAL_DELIVERY_LAUNCHED=true`,
> `CWC_SENATE_PATH_PREFIX=testing-messages`, `TEE_RESOLVER_URL` set; `GCP_PROXY_URL` left unset
> (House disarmed). Readiness computes `launched ✓ / senate ✓ / house ✗`. Prod untouched.

## 1. Stand up the resolver (DONE in code)
`/api/tee/resolve` wraps `getConstituentResolver()` (→ `LocalConstituentResolver` while
`TEE_PUBLIC_KEY_URL` is unset), runs the three gates (decrypt → verify proof → reconcile cell),
and is **INTERNAL_API_SECRET-gated** (it resolves witness data into PII — never a public oracle).
Point `TEE_RESOLVER_URL` at its origin (e.g. `https://<staging-host>/api/tee`).

> **Reachability caveat (readiness vs. actual send).** The Convex deployment runs in Convex's
> CLOUD. It can reach `soapbox.senate.gov` (public) but **cannot reach `http://localhost:5173`**.
> So `TEE_RESOLVER_URL=http://localhost:5173/api/tee` makes readiness green but an actual send
> fails at the resolver hop ("Delivery service unreachable"). For a real sandbox send, point
> `TEE_RESOLVER_URL` at a Convex-reachable `/resolve`: a deployed staging origin, or a tunnel
> (e.g. ngrok) exposing the local `:5173`. The `INTERNAL_API_SECRET` on Convex must equal the one
> the SvelteKit `/resolve` validates against, or the resolver returns 403.

## 2. Convex TEST/staging deployment env
Set on the **Convex** deployment (dashboard or `npx convex env set …` — `npx convex deploy -y`
silently no-ops prod env, per the convex-deploy gotcha). Prefix the Convex CLI with
`NODE_OPTIONS='--dns-result-order=ipv4first --no-network-family-autoselection'` on this machine.

| Var | Value | Read at |
|---|---|---|
| `CONGRESSIONAL_DELIVERY_LAUNCHED` | `true` | `submissions.ts` `isCongressionalDeliveryLaunched` |
| `CWC_API_BASE_URL` | the Senate CWC API base | `getCongressionalTransportConfig` |
| `CWC_API_KEY` | **Senate `testing-messages` sandbox key** (ops-provisioned — see §5) | same |
| `CWC_SENATE_PATH_PREFIX` | `testing-messages` (default; set explicitly to be safe) | `resolveSenatePathPrefix` |
| `TEE_RESOLVER_URL` | origin of the `/resolve` route (no trailing `/resolve`) | resolve fetch |
| `INTERNAL_API_SECRET` | the shared secret (must match the SvelteKit side) | resolve fetch header |
| `GCP_PROXY_URL`, `GCP_PROXY_AUTH_TOKEN` | **LEAVE UNSET** (House disarmed) | House guard |
| `CWC_PRODUCTION` | leave unset (only `=true` unlocks the live `messages` prefix) | `resolveSenatePathPrefix` |

## 3. SvelteKit build (TEST/staging only)
`src/lib/config/features.ts` `CONGRESSIONAL` is a **bundled constant** — flipping it needs a
rebuild. Build the TEST/staging artifact with `CONGRESSIONAL: true`. **Do NOT merge this flip
to the prod build branch** — prod stays `false` so the prod entry endpoint keeps 403-ing.
Also set `INTERNAL_API_SECRET` (and `TEE_RESOLVER_URL` if the resolver reads it) on the
SvelteKit env so `/api/tee/resolve` authenticates the Convex caller.

## 4. Verify the arm
- `getCongressionalDeliveryReadiness` returns `launched=true`, `senateTransportConfigured=true`,
  `houseTransportConfigured=false`, `missing=['GCP_PROXY_URL','GCP_PROXY_AUTH_TOKEN']`.
  Composite `ready=false` is **expected** (it ANDs House) — Senate-arm is proven by
  `senateTransportConfigured=true` + a successful send, not by `ready`.
- Seed a Senate-scoped CWC template (`deliveryMethod:'cwc'`, published, public,
  `recipientConfig.chambers:['senate']`) so only the Senate path runs.
- As a Tier-2+ verified test user, submit → expect a `submissionDeliveryReceipts` row
  `status:'delivered'`, POST URL `…/testing-messages/<officeCode>`, `verificationStatus:'verified'`
  (fires only on `anySuccess`); the owning org's verified-action count is **unchanged**
  (`metersOrgQuota:false`). For `testing-messages`, "verified" means **the sandbox accepted**,
  not that a staffer received it — keep receipt/report copy honest about that.
- Force a resolver-reject (`PROOF_INVALID`) → `verificationStatus:'rejected'`, zero CWC POST.
  Force a sandbox non-200 → receipt `failed`, status stays `pending` (NOT verified).

## 5. Open ops facts
- **Senate `CWC_API_KEY` EXISTS** in `.env` (registered SOAPBox "Communiqué PBC", 40-char key) —
  it just needed copying onto the Convex deployment (done on dev 2026-06-17). The same key serves
  sandbox (`testing-messages`) and live (`messages`); the prefix, not the key, picks the inbox.
- **`TEE_RESOLVER_URL` must be Convex-cloud-reachable** for a real send (see §1 caveat) — the dev
  value points at `localhost`, which is fine for readiness but not for an actual sandbox send.
- **Shadow Atlas** (`SHADOW_ATLAS_URL/api/officials/<district>`) must return `chamber:'senate'`
  officials, else the delivery throws before any send. (Not set on the Convex deployment yet.)
- **House cert migration** — `GCP_PROXY_URL` cert is `house.communi.email`, migrating to
  `house.commons.email`; verify the cert before ever arming House (live).

## Follow-ups (not blocking the arm)
- `getCongressionalDeliveryReadiness` ANDs both chambers; consider per-chamber
  `senateReady`/`houseReady` so a Senate-only arm can report "ready for Senate".
- Remove the now-misleading `CWC_PRODUCTION` description from `.env.example` or document that
  `resolveSenatePathPrefix` is the only consumer.
