# Production Secrets Checklist

This document lists the environment variables required for the Commons production deployment. Source of truth: `.env.example` + `grep process.env` in `src/` and `convex/`.

## Quick Reference: Critical vs Optional

| Priority | Category | Variables |
|----------|----------|-----------|
| **CRITICAL** | Convex | `PUBLIC_CONVEX_URL`, `CONVEX_DEPLOY_KEY` |
| **CRITICAL** | Security Salts | `IDENTITY_HASH_SALT`, `IP_HASH_SALT`, `PSEUDONYMOUS_ID_SALT` |
| **CRITICAL** | AI Services | `GEMINI_API_KEY`, `GROQ_API_KEY` |
| **CRITICAL** | Congressional API | `CWC_API_KEY` |
| **CRITICAL** | Authentication | `JWT_SECRET`, `EMAIL_VERIFICATION_SECRET`, `SESSION_CREATION_SECRET`, `SESSION_COOKIE_SIGNING_SECRET` |
| **HIGH** | Crypto Keys | `CAMPAIGN_PSEUDONYM_KEY`, `DISTRICT_HASH_KEY` (mirror the identical value to Convex — both deployments), `OAUTH_ENCRYPTION_KEY`, `ORG_KEY_WRAPPING_KEY`, `INTERNAL_API_SECRET`, `DISCOVERY_MANIFEST_REFRESH_SECRET`, `RELEASE_CONTROL_SECRET`, `RELEASE_PROBE_SECRET`, `RELEASE_ORIGIN_PROOF_SECRET` |
| **HIGH** | Hidden Pages origin | `PAGES_ORIGIN_ACCESS_TOKEN` (distinct protected production/preview values and token-id proofs) |
| **HIGH** | Protected release evidence | `PROTECTED_PUBLIC_DISCOVERY_R2_READ_*`, `PROTECTED_CLOUDFLARE_QUEUE_FREE_BOOTSTRAP_PRODUCTION_*`, `PROTECTED_RELEASE_RECOVERY_R2_*` |
| **HIGH** | OAuth | `GOOGLE_CLIENT_ID/SECRET`, other OAuth providers |
| **MEDIUM** | VOTER Protocol | `VOTER_API_URL`, `VOTER_API_KEY` |
| **MEDIUM** | Congressional Lookup | `CONGRESS_API_KEY` |
| **MEDIUM** | House Submissions | `GCP_PROXY_URL`, `GCP_PROXY_AUTH_TOKEN` |
| **MEDIUM** | Integrations | `FIRECRAWL_API_KEY`, `SES_FROM_EMAIL`, CWC delivery-agent contact fields |
| **OPTIONAL** | TEE | `TEE_RESOLVER_URL`, `ENCLAVE_PARENT_HOST` |
| **REMOVED** | Identity providers | `DIDIT_*`, `SELF_*` (Cycle 15 — mDL-only) |

---

## 1. Security Salts (CRITICAL)

These salts are used for privacy-preserving identity hashing and fraud detection. **NEVER regenerate `IDENTITY_HASH_SALT` in production** as it would invalidate all existing identity hashes.

### IDENTITY_HASH_SALT

| Field | Value |
|-------|-------|
| **Purpose** | Sybil resistance - deterministic identity hashing for duplicate detection |
| **Used In** | `src/lib/core/server/identity-hash.ts` |
| **Format** | 64-character hex string (256 bits) |
| **Generate** | `openssl rand -hex 32` |
| **Regeneration** | **NEVER** - would require full data migration |

```bash
# Generate value
openssl rand -hex 32
# Example output: a1b2c3d4e5f6...64 characters total
```

### IP_HASH_SALT

| Field | Value |
|-------|-------|
| **Purpose** | Privacy-preserving fraud detection with daily rotation |
| **Used In** | `src/lib/core/server/security.ts` |
| **Format** | 64-character hex string (256 bits) |
| **Generate** | `openssl rand -hex 32` |
| **Regeneration** | Safe to rotate (daily rotation built-in) |

```bash
# Generate value
openssl rand -hex 32
```

---

## 2. Convex Backend (CRITICAL)

### PUBLIC_CONVEX_URL

| Field | Value |
|-------|-------|
| **Purpose** | Public URL of the Convex deployment (client + server read it) |
| **Used In** | `src/lib/server/convex/client.ts`, every frontend convex client |
| **Format** | `https://<deployment>.convex.cloud` |
| **Obtain** | Convex dashboard → Settings → Production deployment URL |

### CONVEX_DEPLOY_KEY

| Field | Value |
|-------|-------|
| **Purpose** | CI/CD deployment auth for `npx convex deploy` |
| **Used In** | `.github/workflows/*.yml`, local `npx convex deploy --env-file .env.production` |
| **Obtain** | Convex dashboard → Settings → Deploy Keys |

---

## 3. Authentication Secrets (CRITICAL)

### JWT_SECRET

| Field | Value |
|-------|-------|
| **Purpose** | JWT token signing for session management |
| **Used In** | `src/lib/core/auth/tokens.ts` |
| **Format** | Strong random string (32+ characters) |
| **Generate** | `openssl rand -base64 32` |
| **Regeneration** | Will invalidate all active sessions |

```bash
# Generate value
openssl rand -base64 32
```

### EMAIL_VERIFICATION_SECRET

| Field | Value |
|-------|-------|
| **Purpose** | Email verification token signing |
| **Used In** | `src/lib/core/auth/tokens.ts` |
| **Format** | Strong random string (32+ characters) |
| **Generate** | `openssl rand -base64 32` |
| **Fallback** | Uses `JWT_SECRET` if not set |

```bash
# Generate value
openssl rand -base64 32
```

### SESSION_CREATION_SECRET

| Field | Value |
|-------|-------|
| **Purpose** | Authorizes SvelteKit to create one Convex session after OAuth/passkey verification |
| **Used In** | Pages session writers and Convex `authOps.createSession` |
| **Format** | Strong random string (32+ bytes) |
| **Generate** | `openssl rand -hex 32` |
| **Placement** | The same active value in Pages and Convex |
| **Rotation** | Keep `_PREVIOUS` on both sides only until in-flight callbacks drain |

### SESSION_COOKIE_SIGNING_SECRET

| Field | Value |
|-------|-------|
| **Purpose** | Signs the locally verified `auth-session` cookie envelope |
| **Used In** | Pages/SvelteKit only; never Convex |
| **Format** | Strong random string (32+ bytes) |
| **Generate** | `openssl rand -hex 32` independently of every creation-proof key |
| **Placement** | Pages only |
| **Rotation** | `_PREVIOUS` may cover the chosen old-cookie lifetime; active and previous values must not equal any session-creation key |

### DISCOVERY_MANIFEST_REFRESH_SECRET

| Field | Value |
|-------|-------|
| **Purpose** | Authorizes only the bounded global public-discovery manifest writer |
| **Used In** | Pages refresh endpoint, Convex producer push, dedicated Cloudflare cron Worker |
| **Format** | Independently generated 32+ byte secret (`openssl rand -hex 32`) |
| **Placement** | Same value in Pages, Convex, the `Production` GitHub Environment, and the cron Worker secret store |
| **Isolation** | Must not equal `INTERNAL_API_SECRET`; the cron Worker receives no broader internal bearer |
| **Rotation** | Pages alone may temporarily accept `DISCOVERY_MANIFEST_REFRESH_SECRET_PREVIOUS`; Convex and the cron Worker send active only |

### RELEASE_CONTROL_SECRET

| Field | Value |
|-------|-------|
| **Purpose** | Authorizes only the T-owned release authority control surface (`arm`, `inspect`, `qualify`, `finalize`, pre-commit `contain`) |
| **Used In** | Dedicated manifest-gate Worker/Durable Object and protected release/recovery workflows only |
| **Format** | Independently generated 32+ byte secret (`openssl rand -hex 32`) |
| **Placement** | Realm-specific gate Worker secret plus GitHub Environment secret `PROTECTED_RELEASE_CONTROL_SECRET_PREVIEW` or `PROTECTED_RELEASE_CONTROL_SECRET_PRODUCTION`; never Pages |
| **Isolation** | Preview and production active/previous sets must be disjoint from each other and every Pages, internal, refresh, session, and provider capability |
| **Naming** | Server-only. `RELEASE_CONTROL_SECRET` must never carry the repo's `PUBLIC_` or `VITE_` prefix |
| **Rotation** | The gate Worker/Durable Object may temporarily accept `RELEASE_CONTROL_SECRET_PREVIOUS`; protected workflows send active only |

### RELEASE_PROBE_SECRET

| Field | Value |
|-------|-------|
| **Purpose** | Authorizes only the separate trusted staging edge's exact `GET /api/release-candidate` candidate-fetch proof |
| **Used In** | Separate trusted staging edge Worker and the protected staging qualification workflow |
| **Placement** | Trusted staging edge secret plus GitHub Staging Environment secret `PROTECTED_RELEASE_PROBE_SECRET_PREVIEW`; never either Pages environment or the production edge |
| **Isolation** | Must differ from every internal, refresh, release-control, session, provider, and mutation capability |
| **Bindings** | Preview Pages has zero secrets and no R2, KV, DO, Queue, mTLS, or service bindings; only the separate trusted staging edge receives this probe secret |

### RELEASE_ORIGIN_PROOF_SECRET

| Field | Value |
|-------|-------|
| **Purpose** | Authorizes only the production trusted edge's exact uncached `GET /api/release-origin` post-C or retained-pair proof |
| **Format** | Independently generated header-safe 32–512 byte secret (`openssl rand -base64 48`) |
| **Placement** | Trusted production edge secret plus GitHub Production Environment secret `PROTECTED_RELEASE_ORIGIN_PROOF_SECRET_PRODUCTION`; exposed only to production edge deployment, exact post-C proof, and retained-pair recovery steps |
| **Workflow-enforced isolation** | The deployment step compares the value pairwise with the Access JSON/id/client secret, Access service-token id, and Cloudflare API token; retained recovery also compares it with the internal-readiness and Cloudflare API tokens |
| **Operator-attested isolation** | It must also differ from staging `RELEASE_PROBE_SECRET`, release-control, refresh, session, and all other provider capabilities. Those raw values intentionally never enter the same step, so protected-environment review records their independent generation instead of weakening step-level least privilege by co-locating them |
| **Forbidden placement** | Never Pages, staging edge/workflow, Convex, source S, commit-authority step, public/repository variable, response, or log |
| **Rotation** | Keep one stable value while any of the newest-eight retained production edge versions may be selected for rollback; rotate only with a separately proven forward release that retires the old rollback set |

The production edge consumes this capability before terminal-authority lookup,
strips its header before Access/origin forwarding, and never admits the proof
path to the landing Cache API. It is not a user, health, cache, publication, or
release-control credential.

### PAGES_ORIGIN_ACCESS_TOKEN

| Field | Value |
|-------|-------|
| **Purpose** | Lets one trusted edge authenticate to its one Access-protected hidden Pages origin |
| **Format** | Canonical JSON object with exactly `cf-access-client-id` and `cf-access-client-secret` string keys |
| **Production placement** | Trusted `commons-trusted-pages-edge` secret plus protected Environment secret `PROTECTED_PAGES_ORIGIN_ACCESS_TOKEN_PRODUCTION` |
| **Preview placement** | Trusted `commons-trusted-pages-edge-staging` secret plus protected Environment secret `PROTECTED_PAGES_ORIGIN_ACCESS_TOKEN_PREVIEW` |
| **Token-id proof** | Separate 32-lowercase-hex `PROTECTED_PAGES_ORIGIN_ACCESS_SERVICE_TOKEN_ID_PRODUCTION` and `_PREVIEW` values |
| **Isolation** | Production and preview credentials and token ids must be distinct; neither value may equal or contain the probe, release-control, internal, refresh, session, or provider capability |
| **Forbidden placement** | Never Pages, Convex, source S, a release artifact, a public/repository variable, response, or log |

Each token belongs to exactly one self-hosted Access application's one Service
Auth/non-identity policy. Both applications must read the token only from
`x-commons-pages-origin-access`. The exact late-transform rule removes that
header after Access, so the Pages candidate receives a valid Access assertion
but not the credential. Do not substitute the standard
`cf-access-client-id`/`cf-access-client-secret` headers, mTLS, an Allow policy,
or a shared token.

Rotation is realm-by-realm and fail-closed: create a new token, update only the
matching Access policy and trusted Worker secret under one protected change,
run the full no-token/wrong-token/cross-token/JWT-only denial matrix plus the
valid purpose-bound proof, then revoke the old token. Never temporarily put two
tokens in one policy or reuse the other realm's token.

There is deliberately no landing-cache purge secret. Publication freshness is
the trusted edge's 60-second fresh, 300-second stale-while-revalidate, and
360-second absolute per-entry stale contract. The inner manifest cache observes
a published coordinate in less than 60 seconds, so the strict
manifest-publication-to-last-old-HTML bound is less than 420 seconds;
`Cache-Tag: public-discovery` is metadata
for a future optional operator optimization, not a launch credential or
publication/rollback dependency.

### Protected public-discovery bootstrap and recovery credentials

These credentials belong only to protected GitHub Environments. They are not
Pages runtime variables, Convex variables, Worker bindings, repository secrets,
or browser configuration.

| Protected Environment secret | Scope and purpose | Required separation |
|-------|-------|-------|
| `PROTECTED_PUBLIC_DISCOVERY_R2_READ_ACCESS_KEY_ID` | S3-compatible key id for exact GET/HEAD completion proof against only `commons-public-discovery-cache` | Pair with an R2 token that has object-read authority only: no write, delete, bucket administration, recovery-bucket access, or Cloudflare control-plane authority; the verifier itself never LISTs |
| `PROTECTED_PUBLIC_DISCOVERY_R2_READ_SECRET_ACCESS_KEY` | Secret half of the same read-only completion-proof credential | Store only in `Production`; never give it to Pages, either trusted edge, Convex, the manifest cron, or the recovery workflow |
| `PROTECTED_CLOUDFLARE_QUEUE_FREE_BOOTSTRAP_PRODUCTION_ATTESTATION_B64` | Base64 of one canonical schema-2 `bootstrap-production` Queue receipt | One exact source SHA, release transaction, and operator; not reusable as either schema-1 activation receipt |
| `PROTECTED_CLOUDFLARE_QUEUE_FREE_BOOTSTRAP_PRODUCTION_SIGNATURE_B64` | Base64 of the detached Ed25519 signature over that canonical receipt | Signing private key remains operator-local; only its reviewed public key/principal belongs in `.github/cloudflare-queue-allowed-signers` |
| `PROTECTED_CLOUDFLARE_QUEUE_FREE_BOOTSTRAP_PRODUCTION_OPERATOR_PRINCIPAL` | Exact principal expected in the receipt | Must equal the enrolled signer principal and receipt value; rotate all three per exact bootstrap transaction |
| `PROTECTED_RELEASE_RECOVERY_R2_ACCESS_KEY_ID` | S3-compatible key id for append-only release custody in only `commons-release-recovery-private` | Separate read/write credential from the discovery read-only pair and from `PROTECTED_CLOUDFLARE_API_TOKEN` |
| `PROTECTED_RELEASE_RECOVERY_R2_SECRET_ACCESS_KEY` | Secret half of the recovery-custody credential | Protected `Staging` and `Production` only; never application runtime, public-discovery storage, logs, artifacts, or workflow outputs |

The Queue observer bearer and Ed25519 signing private key never enter GitHub.
The operator uses them locally to capture two complete observations and sign the
canonical receipt, then uploads only the base64 receipt, base64 signature, and
principal. The bootstrap receipt lasts at most 75 minutes, is verifiable for at
most 72 minutes, cannot cross UTC midnight, and is consumed only if the exact
read-only R2 verifier reports typed incomplete state.

Credential boundaries are intentional:

- the discovery read credential can prove corpus state but cannot create or
  repair it;
- the recovery R2 credential can append/read private transaction custody but
  cannot read public-discovery payloads or mutate Cloudflare routes/scripts;
- `PROTECTED_CLOUDFLARE_API_TOKEN` owns only the separately reviewed live
  control-plane reads and release mutations; and
- `PROTECTED_RELEASE_CONTROL_SECRET_PRODUCTION`, the Pages Access token,
  manifest refresh secret, and internal API secret remain distinct capabilities
  used only in their named proof or application boundary.

The recovery bucket, required lifecycle/object-lock posture, and fresh-runner
procedure are defined in
[`docs/ops/PUBLIC-RELEASE-RECOVERY.md`](../ops/PUBLIC-RELEASE-RECOVERY.md).

---

## 4. Congressional Web Contact (CWC) API (CRITICAL)

### CWC_API_KEY

| Field | Value |
|-------|-------|
| **Purpose** | Senate CWC API authentication for message submissions |
| **Used In** | `src/lib/core/congress/cwc-client.ts` |
| **Obtain** | Apply via Senate CWC Program: https://www.senate.gov/legislative/LIS_MEMBER/Offices/contact_info.htm |
| **Format** | API key string |

### CWC_API_BASE_URL

| Field | Value |
|-------|-------|
| **Purpose** | Senate CWC API endpoint |
| **Default** | `https://soapbox.senate.gov/api` |
| **Required** | Only if using non-standard endpoint |

### Additional CWC Configuration

```bash
CWC_CAMPAIGN_ID=commons-2025
CWC_DELIVERY_AGENT_ID=COMMONS_PBC
CWC_DELIVERY_AGENT_NAME="Commons PBC"
CWC_DELIVERY_AGENT_CONTACT=hello@commons.email
CWC_DELIVERY_AGENT_ACKNOWLEDGEMENT_EMAIL=noreply@commons.email
CWC_DELIVERY_AGENT_ACK=Y
```

---

## 5. Congress.gov API (MEDIUM)

### CONGRESS_API_KEY

| Field | Value |
|-------|-------|
| **Purpose** | Congress.gov API for representative lookup |
| **Used In** | `src/lib/core/congress/address-lookup.ts` |
| **Obtain** | Register at https://api.congress.gov/sign-up/ |
| **Format** | API key string |
| **Fallback** | Uses `CWC_API_KEY` if not set |

---

## 6. AI Moderation APIs (CRITICAL)

### GEMINI_API_KEY

| Field | Value |
|-------|-------|
| **Purpose** | Primary quality assessment (Layer 2) + embeddings |
| **Used In** | `src/lib/core/server/multi-agent-consensus.ts`, `src/lib/core/search/gemini-embeddings.ts` |
| **Obtain** | https://aistudio.google.com/apikey |
| **Format** | `AIza...` (40 characters) |
| **Tier** | Free tier available |

### ANTHROPIC_API_KEY (Optional)

| Field | Value |
|-------|-------|
| **Purpose** | Tie-breaker moderation (Layer 3) - only called when Gemini rejects |
| **Used In** | `src/lib/core/server/multi-agent-consensus.ts` |
| **Obtain** | https://console.anthropic.com/settings/keys |
| **Required** | Optional - system works without it |

---

## 7. Identity Verification (REMOVED)

> **Cycle 15 (2026-02-24):** Both Didit.me and self.xyz were removed as identity providers. mDL via Digital Credentials API is now the sole identity verification method and does not require server-side API keys. The following secrets should be removed from production if still present:
>
> - `DIDIT_API_KEY`
> - `DIDIT_WORKFLOW_ID`
> - `DIDIT_WEBHOOK_SECRET`
> - `SELF_APP_NAME`
> - `SELF_SCOPE`
> - `SELF_MOCK_PASSPORT`
>
> **Cycle 46 (2026-04-30):** The custom direct mDL QR verifier and bridge were
> removed from the active product path. After the browser-mediated-only deployment
> went live at `1da630d0`, these stale Cloudflare Pages secrets were removed from
> production when present:
>
> - `BRIDGE_ENCRYPTION_KEY`
> - `MDL_DIRECT_QR_REQUEST_ALG`
> - `MDL_DIRECT_QR_REQUEST_KID`
> - `MDL_DIRECT_QR_REQUEST_PRIVATE_KEY`
> - `MDL_DIRECT_QR_REQUEST_X5C`
> - `DIRECT_MDL_ALLOWED_ORIGIN`
> - `DIRECT_MDL_SESSION_KV`
>
> Follow-up inventory found no `BRIDGE_ENCRYPTION_KEY`,
> `MDL_DIRECT_QR_REQUEST*`, or `DIRECT_MDL_ALLOWED_ORIGIN` production secrets.

---

## 9. OAuth Providers (HIGH)

All OAuth providers follow the same pattern. Each requires `CLIENT_ID` and `CLIENT_SECRET`.

### Required Base Configuration

```bash
OAUTH_REDIRECT_BASE_URL=https://commons.email
```

### Google OAuth

| Field | Value |
|-------|-------|
| **Obtain** | https://console.cloud.google.com/apis/credentials |

```bash
GOOGLE_CLIENT_ID=xxx.apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=GOCSPX-xxx
```

### Facebook OAuth

| Field | Value |
|-------|-------|
| **Obtain** | https://developers.facebook.com/apps/ |

```bash
FACEBOOK_CLIENT_ID=123456789
FACEBOOK_CLIENT_SECRET=xxx
```

### LinkedIn OAuth

| Field | Value |
|-------|-------|
| **Obtain** | https://www.linkedin.com/developers/apps |

```bash
LINKEDIN_CLIENT_ID=xxx
LINKEDIN_CLIENT_SECRET=xxx
```

### Twitter/X OAuth

| Field | Value |
|-------|-------|
| **Obtain** | https://developer.twitter.com/en/portal/dashboard |

```bash
TWITTER_CLIENT_ID=xxx
TWITTER_CLIENT_SECRET=xxx
```

### Discord OAuth

| Field | Value |
|-------|-------|
| **Obtain** | https://discord.com/developers/applications |

```bash
DISCORD_CLIENT_ID=xxx
DISCORD_CLIENT_SECRET=xxx
```

---

## 10. House CWC Proxy (MEDIUM)

**IMPORTANT:** House of Representatives CWC API requires IP whitelisting from the House vendor program.

**Status as of 2026-01:** House submissions will **FAIL** if not properly configured (no silent simulation).

To enable House submissions, you must:
1. Apply for CWC vendor program: https://www.house.gov/doing-business-with-the-house/communicating-with-congress-cwc
2. Contact CWCVendors@mail.house.gov for IP whitelist approval
3. Deploy a proxy server with whitelisted IP OR get your production server IP whitelisted
4. Configure the environment variables below

**Without configuration:** House submissions fail with clear error messages directing users to contact forms.

### GCP_PROXY_URL

| Field | Value |
|-------|-------|
| **Purpose** | Proxy server with whitelisted IP for House CWC submissions |
| **Used In** | `src/lib/core/congress/cwc-client.ts` |
| **Required** | YES (for House delivery) - Senate works without proxy |
| **Default** | None - must be explicitly configured |
| **Example** | `http://your-whitelisted-proxy.example.com:8080` |

### GCP_PROXY_AUTH_TOKEN

| Field | Value |
|-------|-------|
| **Purpose** | Authentication token for proxy server |
| **Used In** | `src/lib/core/congress/cwc-client.ts` |
| **Required** | Recommended (if proxy requires auth) |

---

## 11. VOTER Protocol Integration (MEDIUM)

### VOTER_API_URL

| Field | Value |
|-------|-------|
| **Purpose** | VOTER protocol API endpoint for reputation scoring |
| **Used In** | `src/lib/core/api/voter.ts` |
| **Default** | `http://localhost:8000` (development) |
| **Production** | `https://reputation.voter.workers.dev` |

### VOTER_API_KEY

| Field | Value |
|-------|-------|
| **Purpose** | Authentication for VOTER protocol API |
| **Used In** | `src/lib/core/api/voter.ts` |
| **Format** | 64-character hex string |
| **Generate** | `openssl rand -hex 32` |

---

## 12. Variables to REMOVE from Production

These variables are **NOT USED** in the current codebase and should be removed if present:

| Variable | Status |
|----------|--------|
| `TWITCH_CLIENT_ID` | **Unused** - No Twitch integration exists |
| `TWITCH_CLIENT_SECRET` | **Unused** - No Twitch integration exists |
| `GROQ_API_KEY` | **Unused** - No Groq integration exists |
| `AWS_ACCESS_KEY_ID` | **Optional** - Only for TEE deployment (not used in Cloudflare) |
| `AWS_SECRET_ACCESS_KEY` | **Optional** - Only for TEE deployment (not used in Cloudflare) |
| `DIDIT_API_KEY` | **Removed** - Didit.me removed in Cycle 15 |
| `DIDIT_WORKFLOW_ID` | **Removed** - Didit.me removed in Cycle 15 |
| `DIDIT_WEBHOOK_SECRET` | **Removed** - Didit.me removed in Cycle 15 |
| `SELF_APP_NAME` | **Removed** - self.xyz removed in Cycle 15 |
| `SELF_SCOPE` | **Removed** - self.xyz removed in Cycle 15 |
| `SELF_MOCK_PASSPORT` | **Removed** - self.xyz removed in Cycle 15 |

---

## Cloudflare Pages Deployment Commands

### Setting Secrets via Wrangler CLI

```bash
# Convex backend
wrangler pages secret put PUBLIC_CONVEX_URL
wrangler pages secret put CONVEX_DEPLOY_KEY

# Security Salts (CRITICAL - generate fresh values)
wrangler pages secret put IDENTITY_HASH_SALT
wrangler pages secret put IP_HASH_SALT

# Authentication Secrets
wrangler pages secret put JWT_SECRET
wrangler pages secret put EMAIL_VERIFICATION_SECRET
wrangler pages secret put SESSION_CREATION_SECRET
wrangler pages secret put SESSION_COOKIE_SIGNING_SECRET
wrangler pages secret put DISCOVERY_MANIFEST_REFRESH_SECRET
# Receiver-only during rotation; never mirror this previous value to a sender.
# wrangler pages secret put DISCOVERY_MANIFEST_REFRESH_SECRET_PREVIOUS
# Mirror only the creation-proof key to the selected Convex deployment.
npx convex env set SESSION_CREATION_SECRET
# Mirror the dedicated manifest capability and exact writer URL to Convex.
npx convex env set DISCOVERY_MANIFEST_REFRESH_SECRET
npx convex env set PUBLIC_DISCOVERY_MANIFEST_REFRESH_URL
# After the cron Worker exists, provision its same dedicated capability.
wrangler secret put DISCOVERY_MANIFEST_REFRESH_SECRET \
  --config wrangler.public-discovery-manifest.toml

# Hidden-origin credentials are Worker secrets, never Pages secrets.
# Prefer the protected workflow; these local commands require realm-specific
# operator input and must never echo or persist the JSON.
wrangler secret put PAGES_ORIGIN_ACCESS_TOKEN \
  --config wrangler.trusted-pages-release-edge.toml
wrangler secret put RELEASE_ORIGIN_PROOF_SECRET \
  --config wrangler.trusted-pages-release-edge.toml
wrangler secret put PAGES_ORIGIN_ACCESS_TOKEN \
  --config wrangler.trusted-pages-release-edge-staging.toml

# Congressional APIs
wrangler pages secret put CWC_API_KEY
wrangler pages secret put CONGRESS_API_KEY

# AI Moderation. Paid-provider credentials (EXA_API_KEY, FIRECRAWL_API_KEY,
# GEMINI_API_KEY, GROQ_API_KEY) are protected workflow inputs only. Normal
# release ephemerally stages them at the immutable Pages upload seam, proves
# the deployment snapshot, then clears project defaults; never put them here.
wrangler pages secret put ANTHROPIC_API_KEY

# Identity Verification - Didit.me (REMOVED in Cycle 15 - delete these if present)
# wrangler pages secret put DIDIT_API_KEY
# wrangler pages secret put DIDIT_WORKFLOW_ID
# wrangler pages secret put DIDIT_WEBHOOK_SECRET

# OAuth Providers
wrangler pages secret put OAUTH_REDIRECT_BASE_URL
wrangler pages secret put GOOGLE_CLIENT_ID
wrangler pages secret put GOOGLE_CLIENT_SECRET
wrangler pages secret put FACEBOOK_CLIENT_ID
wrangler pages secret put FACEBOOK_CLIENT_SECRET
wrangler pages secret put LINKEDIN_CLIENT_ID
wrangler pages secret put LINKEDIN_CLIENT_SECRET
wrangler pages secret put TWITTER_CLIENT_ID
wrangler pages secret put TWITTER_CLIENT_SECRET
wrangler pages secret put DISCORD_CLIENT_ID
wrangler pages secret put DISCORD_CLIENT_SECRET

# House CWC Proxy
wrangler pages secret put GCP_PROXY_URL
wrangler pages secret put GCP_PROXY_AUTH_TOKEN

# VOTER Protocol
wrangler pages secret put VOTER_API_URL
wrangler pages secret put VOTER_API_KEY
```

### Setting Secrets via Cloudflare Dashboard

1. Navigate to **Cloudflare Dashboard** > **Pages** > **commons**
2. Go to **Settings** > **Environment variables**
3. Add each secret under **Production** environment
4. Click **Encrypt** for sensitive values (API keys, secrets)

---

## Pre-Deployment Checklist

### Critical (Must Have)

- [ ] `PUBLIC_CONVEX_URL` - Production Convex deployment URL
- [ ] `CONVEX_DEPLOY_KEY` - For CI/CD Convex deploys
- [ ] `IDENTITY_HASH_SALT` - Generated with `openssl rand -hex 32`
- [ ] `IP_HASH_SALT` - Generated with `openssl rand -hex 32`
- [ ] `JWT_SECRET` - Generated with `openssl rand -base64 32`
- [ ] `SESSION_CREATION_SECRET` - Generated with `openssl rand -hex 32` and mirrored to Convex
- [ ] `DISTRICT_HASH_KEY` - Generated with `openssl rand -hex 32` and mirrored verbatim to Convex (production AND dev deployments). Both runtimes write the same `districtHash` column, so a mismatch splits every aggregate; hashing throws when unset, hard-failing campaign action submission, donations, and event RSVP. Never rotate after launch
- [ ] `SESSION_COOKIE_SIGNING_SECRET` - Independently generated with `openssl rand -hex 32`, Pages only
- [ ] `DISCOVERY_MANIFEST_REFRESH_SECRET` - Independent 32+ byte value mirrored only to Pages, Convex, GitHub Environment, and the dedicated cron Worker
- [ ] `DISCOVERY_MANIFEST_REFRESH_SECRET_PREVIOUS` - Empty normally; old active value on Pages only during a bounded sender-rotation overlap
- [ ] `PROTECTED_PAGES_ORIGIN_ACCESS_TOKEN_PRODUCTION` - Exact two-key JSON for only the production trusted edge
- [ ] `PROTECTED_PAGES_ORIGIN_ACCESS_TOKEN_PREVIEW` - Distinct exact two-key JSON for only the staging trusted edge
- [ ] `PROTECTED_PAGES_ORIGIN_ACCESS_SERVICE_TOKEN_ID_PRODUCTION` and `_PREVIEW` - Distinct exact token-id proofs
- [ ] `PROTECTED_RELEASE_ORIGIN_PROOF_SECRET_PRODUCTION` - Independent header-safe 32–512 byte value live only in the production trusted edge deployment, exact post-C proof, and retained-pair recovery steps
- [ ] `PROTECTED_PUBLIC_DISCOVERY_R2_READ_ACCESS_KEY_ID` and `_SECRET_ACCESS_KEY` - Production-only Object Read credential scoped to `commons-public-discovery-cache`; the verifier uses exact GET/HEAD and never LISTs or writes
- [ ] `PROTECTED_CLOUDFLARE_QUEUE_FREE_BOOTSTRAP_PRODUCTION_ATTESTATION_B64`, `_SIGNATURE_B64`, and `_OPERATOR_PRINCIPAL` - Fresh schema-2 receipt set bound to the exact source SHA and `<run-id>-<run-attempt>`, with 4,320/3,960/180-second proof reserves
- [ ] `PROTECTED_RELEASE_RECOVERY_R2_ACCESS_KEY_ID` and `_SECRET_ACCESS_KEY` - Object read/write credential scoped only to locked private bucket `commons-release-recovery-private`, present in protected `Staging` and `Production`
- [ ] Discovery-read, release-recovery, Cloudflare mutation, release-control, Access, manifest-refresh, and internal-readiness credentials are independently issued and do not cross their documented jobs or runtime boundaries
- [ ] Queue observer token and Ed25519 private signing key remain operator-local; no private signer material or observer bearer is stored in GitHub
- [ ] Workflow proof confirms the release-origin value differs from every capability present in its edge-deploy or retained-recovery step: Access JSON/id/client secret, Access service-token id, internal readiness, and Cloudflare API
- [ ] Protected-environment operator attestation records independent generation from staging-probe, release-control, refresh, session, and all other provider capabilities without co-locating those raw values; the proof value remains stable across the retained rollback window
- [ ] Pages project-default inventory in both production and preview contains none of `PAGES_ORIGIN_ACCESS_TOKEN`, `RELEASE_CONTROL_SECRET`, `RELEASE_PROBE_SECRET`, `RELEASE_ORIGIN_PROOF_SECRET`, or provider credentials; the exact immutable production deployment alone retains the four provider bindings
- [ ] Pages, Convex, and Worker secret inventories contain none of `PROTECTED_PUBLIC_DISCOVERY_R2_READ_*`, `PROTECTED_RELEASE_RECOVERY_R2_*`, or `PROTECTED_CLOUDFLARE_QUEUE_FREE_*`; these exist only in their protected workflow Environments
- [ ] No publication or landing-cache purge credential exists in Pages, either trusted Worker, Convex, or protected Environments
- [ ] The complete overlapping Access app/policy/token inventory equals the two expected Service-Auth-only apps; DNS, Pages domains/deployment aliases, Worker routes, and `pages.dev` closure contain no stale `staging.commons.email` Pages/branch alias
- [ ] Both Access apps, exact Worker and finalized Pages runtime dates/ordered flags, the late transform, hidden-origin inventory, cross-token denial, and valid candidate proof pass the live trusted-edge verifier
- [ ] After terminal C, exact uncached `/api/release-origin` requires the dedicated proof header, then proves the committed SHA/transaction, proof/Access tokens absent at origin, candidate Cache API unavailable, and external I/O zero; rollback proves the retained Pages/T pair in the same way
- [ ] Production Convex is active under reviewed quota authority; the current quota-disabled team is still a launch blocker
- [ ] Protected provider posture bundle - exact Exa, Firecrawl, Gemini, and Groq credentials/account IDs plus a fresh independently signed Free-plan, billing-disabled, no-PAYG receipt; never persistent Pages project defaults
- [ ] `CWC_API_KEY` - For Senate submissions

### High Priority

- [x] ~~`DIDIT_API_KEY`~~ - Removed (Cycle 15)
- [x] ~~`DIDIT_WORKFLOW_ID`~~ - Removed (Cycle 15)
- [x] ~~`DIDIT_WEBHOOK_SECRET`~~ - Removed (Cycle 15)
- [ ] `OAUTH_REDIRECT_BASE_URL` - Set to production domain
- [ ] At least one OAuth provider configured (Google recommended)

### Medium Priority

- [ ] `CONGRESS_API_KEY` - For representative lookup
- [ ] `GCP_PROXY_URL` + `GCP_PROXY_AUTH_TOKEN` - For House submissions
- [ ] `ANTHROPIC_API_KEY` - For tie-breaker moderation
- [ ] `VOTER_API_URL` + `VOTER_API_KEY` - For reputation scoring
- [ ] `EMAIL_VERIFICATION_SECRET` - For email verification tokens

### Verification

After setting all secrets, verify deployment:

```bash
set -euo pipefail
# Check that secrets are set (values are hidden)
wrangler pages secret list

# Trigger the gated staging deployment for a SHA already on staging
git fetch --no-tags origin staging
RELEASE_SHA=$(git rev-parse HEAD)
if ! git merge-base --is-ancestor "$RELEASE_SHA" origin/staging; then
  echo "Refusing deploy: $RELEASE_SHA is not contained in origin/staging." >&2
  exit 1
fi
gh workflow run deploy.yml --ref main -f branch=staging -f ref="$RELEASE_SHA"
```

Never validate production secrets with a direct `wrangler pages deploy`; it
bypasses the repository's producer-readiness and exact-SHA release gates.

---

## Security Notes

1. **Never commit secrets to git** - Use `.env.local` for development
2. **Rotate secrets periodically** - Except `IDENTITY_HASH_SALT` (requires migration)
3. **Use Cloudflare's encryption** - Always encrypt sensitive values in dashboard
4. **Audit access** - Limit who can view/modify production secrets
5. **Monitor for leaks** - Set up alerts for exposed credentials

---

## Troubleshooting

### "IDENTITY_HASH_SALT environment variable not configured"

The identity verification system requires this salt. Generate and set it:

```bash
openssl rand -hex 32 | wrangler pages secret put IDENTITY_HASH_SALT
```

### "IP_HASH_SALT environment variable not configured"

The fraud detection system requires this salt. Generate and set it:

```bash
openssl rand -hex 32 | wrangler pages secret put IP_HASH_SALT
```

### ~~"Didit.me integration not configured"~~

Didit.me was removed in Cycle 15. If you see this error, the codebase still contains legacy Didit.me references that need cleanup. mDL via Digital Credentials API is the sole identity provider.

### OAuth login fails

Ensure `OAUTH_REDIRECT_BASE_URL` matches your production domain exactly (e.g., `https://commons.email`).
