# Federation Deploy

Status: `INFORMATIONAL` — peer-implementation deployment recipe (Phase 0d).
Last updated: 2026-05-04.

This is the deployment recipe a peer implementation needs to stand up an
independent instance of the Commons protocol on its own domain. It is not
a federation-readiness claim. Federation is not yet operationally complete
— see `voter-protocol/GOVERNANCE.md` (walkaway test). Phase 0d closed the
parameter-leak surface so a peer impl *can* deploy under its own DID,
origin, and atlas host without re-forking.

---

## Coordinated environment variables

A peer deployment must set every variable below. Defaults preserve the
reference `commons.email` deployment so SvelteKit, Convex, and the Cloudflare
build agree out of the box. Each variable is read at a specific runtime —
get them wrong and the auth bridge silently mismatches.

| Variable | Runtime | Default | Notes |
|---|---|---|---|
| `ISSUER_DID` | SvelteKit server | `did:web:commons.email` | W3C VC issuer for Tier 2 `DistrictResidencyCredential`. Must be served via did:web at `<host>/.well-known/did.json`. |
| `CONVEX_AUTH_ISSUER` | SvelteKit server **and** Convex dashboard | `https://commons.email` | JWT `iss` claim and Convex `tokenIdentifier` prefix. Trailing slash is stripped at runtime. |
| `CONVEX_JWT_KID` | SvelteKit server **and** Convex dashboard | `commons-convex-1` | JWKS key id. Changing invalidates active sessions because Convex caches JWKS by kid. |
| `PUBLIC_BASE_URL` | SvelteKit (`$env/dynamic/private` + build) and Convex | `https://commons.email` | Site origin. Used by report email links and OG meta. |
| `PUBLIC_ATLAS_HOST` | Browser bundle (Vite-injected, build time) | `https://atlas.commons.email` | Browser-side atlas host for static district bundles. Read by `svelte.config.js` to seed CSP `connect-src`. |
| `SHADOW_ATLAS_URL` | Convex dashboard | `https://atlas.commons.email` | Server-side atlas URL. Read by Convex actions that look up officials and register engagement. Must match `PUBLIC_ATLAS_HOST`. |
| `ATLAS_BASE_URL` / `VITE_ATLAS_BASE_URL` | SvelteKit server / browser | `https://atlas.commons.email` | Static R2 source URL for client-side ZKP cell bundles. |
| `IDENTITY_SIGNING_KEY` | SvelteKit server | (required) | Ed25519 private key whose corresponding `verificationMethod` must appear in your published `did.json`. |

Two atlas variables exist on purpose. `PUBLIC_ATLAS_HOST` is a Vite-injected
browser constant; `SHADOW_ATLAS_URL` is read by Convex actions inside the
Convex runtime. Set both to the same host.

---

## JWKS hosting

Convex verifies SvelteKit-minted JWTs by fetching your JWKS document. Your
deployment **must** serve a valid JWKS at:

```
$CONVEX_AUTH_ISSUER/.well-known/jwks.json
```

The route is implemented at `src/routes/.well-known/jwks.json/+server.ts` —
nothing peer-specific, but verify it returns your public key after deploy.
Generate the keypair with:

```
node scripts/generate-convex-jwk.mjs
```

Set the resulting `CONVEX_JWT_PRIVATE_KEY` in your SvelteKit secrets, and set
`CONVEX_AUTH_ISSUER` and `CONVEX_JWT_KID` consistently in **both** the
SvelteKit env and the Convex dashboard. (Convex pulls auth-config env at
deploy time; SvelteKit pulls at request time via the CF Workers env shim in
`hooks.server.ts` — both must agree.)

If `CONVEX_JWT_KID` differs between minter and consumer, every request will
fail JWT verification with "kid not found". If `CONVEX_AUTH_ISSUER` differs,
every request will fail with "issuer mismatch". Trailing-slash drift is
specifically guarded against (the runtime strips it) — the rest is on you.

---

## did:web hosting

Tier 2 credentials are W3C Verifiable Credentials issued under your
`ISSUER_DID`. For `did:web:peer.example.org`, you must serve:

```
https://peer.example.org/.well-known/did.json
```

containing a `verificationMethod` whose public key matches the private seed
in `IDENTITY_SIGNING_KEY`. Verifiers (your own and any third party) resolve
the DID, fetch your `did.json`, and check the credential signature. If the
DID document is unreachable or the key doesn't match, every Tier 2
verification fails closed.

The route is implemented in this repo and peer-portable; verify it returns
your DID document with the right verification method after deploy.

---

## Atlas R2 / IPFS pipeline

Browser-side ZKP bundles are static GeoJSON keyed by H3 cell, served from
your atlas host. The reference build publishes to Cloudflare R2 with the
`atlas.commons.email` custom domain. To run your own atlas:

1. Provision an R2 bucket and bind it to a custom domain (or any HTTPS
   origin). Set `PUBLIC_ATLAS_HOST`, `SHADOW_ATLAS_URL`, `ATLAS_BASE_URL`,
   and `VITE_ATLAS_BASE_URL` to that origin.
2. Run the atlas worker (see `commons-subnet/atlas-worker`) to publish the
   district bundle for your jurisdiction.
3. Optionally set `IPFS_CID_ROOT` and `IPFS_GATEWAYS` to layer IPFS as a
   secondary content source — the codebase reads both, R2 first.

The atlas root must be referenced by the on-chain `DistrictRegistry` for
proofs to verify against the same boundary set the prover used. That
contract is presently self-referential (anchored via `EXPECTED_CELL_MAP_ROOT`
in env). When `DistrictRegistry` lands on-chain, peer deployments will read
the root from the contract instead.

---

## CSP coordination

`svelte.config.js` reads `PUBLIC_ATLAS_HOST` at config-evaluation time and
appends it to `connect-src`, with `https://atlas.commons.email` as a stable
fallback. If you set `PUBLIC_ATLAS_HOST` and your atlas bundles still 404
from the browser, your build did not pick up the env var — verify with:

```
grep -A 30 "connect-src" .svelte-kit/output/server/index.js | head -40
```

(or check the `Content-Security-Policy` header on a deployed request).

---

## Deploy-time consistency check

A deployment is consistent when, for the same `$BASE_HOST`:

- `https://$BASE_HOST/.well-known/jwks.json` returns a key whose `kid`
  matches `CONVEX_JWT_KID`.
- `https://$BASE_HOST/.well-known/did.json` returns a verification method
  whose public key matches `IDENTITY_SIGNING_KEY`.
- `CONVEX_AUTH_ISSUER` (set in both SvelteKit and Convex dashboard) equals
  `https://$BASE_HOST` (no trailing slash).
- `PUBLIC_BASE_URL` (SvelteKit + Convex dashboard) equals `https://$BASE_HOST`.
- `PUBLIC_ATLAS_HOST` and `SHADOW_ATLAS_URL` (Convex dashboard) point at the
  same atlas origin.

Run a smoke check by issuing one Tier 1 verification and one Tier 2
credential issuance under the new origin. Any mismatch surfaces as a 401 on
serverQuery() or a credential signature failure on the verifier side.

---

## Federation status (honest framing)

These variables let a peer impl run an independent instance under its own
substrate. They do not by themselves make the protocol federated. The
walkaway test in `voter-protocol/GOVERNANCE.md` defines operational
federation: another implementer must be able to operate a peer deployment
without Communiqué's cooperation, and the protocol must keep working if
Communiqué walks away. That posture is targeted, not yet met. This is the
deployment recipe — what a peer needs to try the protocol under its own
DID, origin, and atlas pre-launch.
