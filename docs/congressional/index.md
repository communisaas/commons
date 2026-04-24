# Message Delivery Documentation

> ⚠️ **CONGRESSIONAL FEATURE GATED OFF (2026-04-23 audit).**
> `FEATURES.CONGRESSIONAL = false` (`src/lib/config/features.ts:24`) — the
> congressional flow documented here is code-complete but not rendered in
> the default deployment. Treat the "Overview" and delivery descriptions
> as the *target* shape.
>
> Specific corrections vs the body below:
>
> - **Endpoint:** `POST /api/submissions/create`
>   (`src/routes/api/submissions/create/+server.ts`). The
>   `/api/congressional/*` tree was not shipped.
> - **Circuit:** `three_tree_membership`, **31 public inputs** (enforcement
>   at `+server.ts:~125` as `!== 31`).
> - **TEE:** Planned, not deployed. Witness-encryption wiring exists; the
>   active resolver is `LocalConstituentResolver`
>   (`docs/implementation-status.md:~113`).
> - **Identity:** Active intake is mDL via W3C Digital Credentials API.
>   Passkey WebAuthn is **not enabled** (`FEATURES.PASSKEY = false`).

**How the voter-protocol enables civic impact tracking and coordination.**

---

## Overview

**What users care about**: Did my message have impact? Can I track it?

**What the protocol delivers**:
- Track your civic actions over time
- See coordination with others ("5,000 people contacted Senator Warren about housing")
- Build on-chain reputation for civic participation (ERC-8004)
- Collective power through coordination visibility

**Two ways to participate**:
1. **Join the protocol** (recommended) - Connect OAuth, get impact tracking, reputation, coordination visibility
2. **Send without tracking** - No OAuth, message gets sent but no verification/tracking

**Who you can contact**: ANY decision-maker (Congress, local gov, corporations, HOAs, universities, healthcare, nonprofits)

**User perspective**: "I want to track my civic impact" not "Which delivery method?"

---

## Core Documentation

### 1. [delivery.md](delivery.md) - Protocol Participation Guide

**Read this first**. Explains the voter-protocol utility and how to participate.

**Key insight**: Users care about **tracking civic impact and coordinating with others**, not backend implementation details.

**Covers**:
- Two ways to participate (join protocol vs send without tracking)
- Protocol utility (impact tracking, reputation, coordination visibility)
- Who you can contact (ANY decision-maker with community impact)
- Technical implementation (zero-knowledge verification, OAuth)
- Privacy guarantees (what we verify, what we don't access)
- Roadmap (protocol expansion, Phase 1-4)

**What's new**: Protocol-first framing. OAuth enables the protocol (impact tracking, reputation, coordination), not just "delivery verification."

**Start here**: [delivery.md](delivery.md)

---

### 2. [congressional-submit.md](congressional-submit.md) - Congressional Submit Implementation

CWC API endpoint implementation, ZK proof verification, message delivery flow.

---

### 3. Congressional Office Dashboard (planned)

Dashboard for congressional offices to view verified constituent messages.

**What it provides**:
- Message inbox (verified constituents only)
- District verification badges
- Aggregate constituent sentiment
- Issue tracking by volume

**Privacy**: Offices see district verification proof, not plaintext addresses.

**Scope**: US Congress (CWC API messages only)

---

## How Protocol Participation Works

### When You Join the Protocol (Recommended)

**What you do**: Connect your email via OAuth

**What you get**:
- **Impact tracking**: Dashboard showing all civic actions you've taken
- **Coordination visibility**: "5,000 people in your district contacted Senator Warren this week"
- **Reputation building**: On-chain ERC-8004 reputation for civic participation
- **One-click sending**: We handle delivery, verification, credit

**Technical flow**:
```
1. Connect OAuth (Gmail, Outlook, etc.) - one-time setup
2. Customize message template
3. Click "Send" - we handle everything
4. Zero-knowledge verification:
   - For Congress: Address proof generated, message + proof delivered
   - For others: We verify Sent folder (template was sent, message intact)
5. Reputation updates on-chain, impact tracked in dashboard
```

**Privacy**:
- OAuth is read-only (Sent folder only)
- Zero-knowledge verification (we verify template sent, don't read full content)
- For congressional messages: Address verified via ZK proof (office sees district, not address)
- Revoke access anytime

---

### When You Send Without Tracking

**What you do**: Don't connect OAuth

**What happens**:
- Message gets sent (your email client opens, you send manually)
- No verification, no credit
- Outside the voter-protocol

**Trade-off**:
- No impact tracking
- No reputation building
- No coordination visibility
- Can't see civic action history

---

## Privacy Architecture (Protocol Participation)

**What congressional offices see**:
- ✅ Zero-knowledge proof of district membership
- ✅ Message content
- ✅ Timestamp
- ✅ Template category

**What congressional offices DON'T see**:
- ❌ Plaintext address
- ❌ User's email address (unless user includes it in message)
- ❌ User's identity (unless user includes name in message)

**Privacy guarantees**:
- Address encrypted in browser using witness encryption
- TEE decrypts only during proving (2-5s window)
- Address never persists in TEE memory
- Proof is zero-knowledge (reveals district, not address)
- CWC API receives proof + message, not address

**For direct email privacy**, see `/docs/strategy/delivery-verification.md`

---

## CWC API Integration Details

**Authentication**:
```env
CWC_API_KEY=... # Set in .env
CWC_API_BASE_URL=https://soapbox.senate.gov/api
```

**Rate limits**:
- 10 submissions per hour per user (prevents spam)
- Tracked via rate limiter (in-memory per-isolate; Redis via `REDIS_URL` in production)
- User sees: "Rate limit reached, try again in X minutes"

**Error handling**:
- Delivery failures → automatic retry (max 3 attempts)
- Invalid address → user prompted to verify
- CWC API down → queue message for later delivery

---

## Deployment Requirements

**Environment variables**:
```env
# CWC API
CWC_API_KEY=... # Required
CWC_API_BASE_URL=... # Optional (defaults to production)

# TEE Configuration
AWS_NITRO_ENCLAVE_ENABLED=true # Production only
TEE_PUBLIC_KEY=... # TEE enclave public key

# Rate Limiting (optional — in-memory by default)
REDIS_URL=... # Optional Redis for distributed rate limiting
```

**Infrastructure**:
- AWS Nitro Enclaves (ARM Graviton, hypervisor-isolated)
- Cloudflare Workers (application hosting)
- Convex (data persistence, managed backend)

---

## Testing

**Integration tests**:
```bash
npm run test:integration -- congressional-delivery.test.ts
```

**What's tested**:
- CWC API submission flow
- Rate limiting enforcement
- Delivery receipt verification
- Error handling and retries
- TEE proof generation (mocked in tests)

**Mocking**:
- CWC API responses mocked
- TEE proving mocked (use deterministic test proofs)
- Rate limiter mocked (in-memory tracking)

---

## Troubleshooting

**Message delivery failed**:
1. Check CWC API status
2. Verify API key is valid
3. Check rate limits (user may have hit limit)
4. Check TEE enclave health
5. Review error logs in Cloudflare Pages

**Proof generation failed**:
1. Check TEE enclave is running
2. Verify address is valid (geocoding succeeded)
3. Check Noir proving timeout (should be <10s)
4. Review TEE logs

**Congressional office reports message not received**:
1. Check delivery receipt in database
2. Verify CWC API returned success
3. Check message wasn't spam filtered by office
4. Provide delivery receipt as proof

---

## For Congressional Staff

**Setting up dashboard access**:
1. Contact Commons team for dashboard credentials
2. Navigate to `/congressional/dashboard`
3. View verified constituent messages
4. Filter by issue category, date range
5. Export messages as CSV

**Understanding verification badges**:
- ✅ Green badge: Zero-knowledge district proof verified
- ⏳ Yellow badge: Verification pending
- ❌ Red badge: Verification failed (likely spam)

**Privacy questions**:
- "Can you see constituent addresses?" → No, we store only commitment hashes
- "How do you verify district?" → Zero-knowledge proof (Noir circuit)
- "Can constituents fake verification?" → No, proof is cryptographically secure

---

## Cross-References

**TEE architecture** → See `/docs/architecture/tee-systems.md`

**Zero-knowledge proofs** → See `/docs/specs/zk-proof-integration.md`

**VOTER Protocol integration** → See `/docs/integration.md`

**Message templates** → See `/docs/features/templates.md`
