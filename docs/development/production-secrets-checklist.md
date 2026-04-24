# Production Secrets Checklist

This document lists the environment variables required for the Commons production deployment. Source of truth: `.env.example` + `grep process.env` in `src/` and `convex/`.

## Quick Reference: Critical vs Optional

| Priority | Category | Variables |
|----------|----------|-----------|
| **CRITICAL** | Convex | `PUBLIC_CONVEX_URL`, `CONVEX_DEPLOY_KEY` |
| **CRITICAL** | Security Salts | `IDENTITY_HASH_SALT`, `IP_HASH_SALT`, `PSEUDONYMOUS_ID_SALT` |
| **CRITICAL** | AI Services | `GEMINI_API_KEY`, `GROQ_API_KEY` |
| **CRITICAL** | Congressional API | `CWC_API_KEY` |
| **CRITICAL** | Authentication | `JWT_SECRET`, `EMAIL_VERIFICATION_SECRET`, `SESSION_CREATION_SECRET` |
| **HIGH** | Crypto Keys | `BRIDGE_ENCRYPTION_KEY`, `CAMPAIGN_PSEUDONYM_KEY`, `DISTRICT_HASH_KEY`, `OAUTH_ENCRYPTION_KEY`, `ORG_KEY_WRAPPING_KEY`, `INTERNAL_API_SECRET` |
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

# Congressional APIs
wrangler pages secret put CWC_API_KEY
wrangler pages secret put CONGRESS_API_KEY

# AI Moderation
wrangler pages secret put GEMINI_API_KEY
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
- [ ] `GEMINI_API_KEY` - For agents + embeddings
- [ ] `GROQ_API_KEY` - For the 2-layer moderation pipeline
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
# Check that secrets are set (values are hidden)
wrangler pages secret list

# Trigger a test deployment
wrangler pages deploy
```

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
