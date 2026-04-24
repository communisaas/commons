# Tier 1 Integration Blueprint

**Status:** ACTIVE — guides Tasks #2, #3, #4, #5
**Scope:** Flip ADDRESS_SPECIFICITY → 'district', CONGRESSIONAL → true, DEBATE → true

> Reconciliation note (2026-04-23). `ADDRESS_SPECIFICITY` is already `'district'` and `DEBATE` is already `true` in production; only `CONGRESSIONAL` remains flag-gated off. The canonical schema lives in `convex/schema.ts`; when checking a claim from this blueprint, grep `convex/schema.ts` or `convex/*.ts` for the table/field name.

---

## 1. District Verification (ADDRESS_SPECIFICITY → 'district')

### What exists

| Layer | File | Status |
|-------|------|--------|
| Address form (full street) | `src/lib/components/onboarding/AddressCollectionForm.svelte` | Built. Calls `/api/location/resolve-address`, shows reps, supports skip. |
| Address resolution API | `src/routes/api/location/resolve-address/+server.ts` | Built. Shadow Atlas primary, Census fallback. Returns `district.code`, `cell_id`, `zk_eligible`, `officials[]` with `cwc_code`. |
| Credential issuance | `src/lib/core/identity/district-credential.ts` | Built. `issueDistrictCredential()` → Ed25519-signed W3C VC 2.0. |
| Three-tree registration | `src/lib/core/identity/shadow-atlas-handler.ts` | Built. `registerThreeTree()` → Tree 1 (identity), Tree 2 (cell/district), Tree 3 (engagement). Client-side only. |
| Verification handler | `src/lib/core/identity/verification-handler.ts` | Built. TEE blob encryption + session credential. |
| Campaign page | `src/routes/c/[slug]/+page.svelte` | Built. Collects postal code only. `verificationTier` is 0 (none) or 1 (postal) or 2 (mDL). |
| Campaign server | `src/routes/c/[slug]/+page.server.ts` | Built. Hashes postal code into `districtHash`. No street address → no real district. |

### What's missing — the gap

The campaign action flow (`/c/[slug]`) currently asks for a **postal code** and hashes it. When ADDRESS_SPECIFICITY is 'district', it must instead:

1. **Replace postal code input with AddressCollectionForm** on the identify step when the campaign type is LETTER and targets have `district` fields.
2. **Issue a district credential** after address verification succeeds — call `issueDistrictCredential()` server-side, return the VC to the client.
3. **Compute a real district hash** from the resolved congressional district code (e.g. `"CA-12"`) instead of hashing the postal code.
4. **Upgrade trust_tier on User** (if authenticated) from tier 1 → tier 2 after district credential issuance.
5. **Store `districtHash`** on `CampaignAction` using `hashDistrict(districtCode)` instead of `hashDistrict(postalCode)`.

### Wiring instructions (Task #2)

**Client (`+page.svelte`):**

```
// In the 'identify' step, conditionally render:
{#if FEATURES.ADDRESS_SPECIFICITY === 'district' && campaign.type === 'LETTER'}
    <AddressCollectionForm
        _template={{ title: campaign.title, deliveryMethod: 'congressional' }}
        oncomplete={(data) => {
            // data.address, data.verified, data.representatives
            // Store district code from data for form submission
        }}
    />
{:else}
    <!-- existing postal code input -->
{/if}
```

The `oncomplete` callback receives `{ address, verified, streetAddress, city, state, zip, representatives }`. Extract the congressional district from the resolve-address response (it's returned as `district.code` in the API but not currently threaded through AddressCollectionForm's callback). **Gap:** AddressCollectionForm's `oncomplete` does not include district code. Add a `district?: string` field to the callback data, populated from `data.district.code` in the resolve-address response.

**Server (`+page.server.ts`):**

When `FEATURES.ADDRESS_SPECIFICITY === 'district'` and the form includes a `districtCode` field (hidden input set by client):

1. Validate `districtCode` matches pattern `/^[A-Z]{2}-(\d{2}|AL)$/`
2. Call `hashDistrict(districtCode)` instead of hashing the postal code
3. Set `engagementTier: 2` (District Verified) instead of `1`
4. Optionally: call `issueDistrictCredential()` if user is authenticated, store credential hash in session

**Key constraint:** The campaign page is public (no auth required). District credential issuance requires `userId`. For unauthenticated users: store `districtHash` on the `CampaignAction` with `engagementTier: 2` but skip credential issuance. For authenticated users (have `locals.user`): also issue the credential and upgrade `trust_tier`.

### Env vars required
- `IDENTITY_SIGNING_KEY` — Ed25519 hex seed (32 bytes). Generate: `openssl rand -hex 32`
- `IDENTITY_HASH_SALT` — legacy HMAC salt (backward compat, existing)
- `DISTRICT_HASH_SALT` — already used in current postal code hashing

---

## 2. Congressional Delivery (CONGRESSIONAL → true)

### What exists

| Layer | File | Status |
|-------|------|--------|
| Submission handler | `src/lib/core/congressional/submission-handler.ts` | Built. Stores ZK proof, queues blockchain verification. **No CWC delivery.** |
| Blockchain verification | `src/lib/core/blockchain/district-gate-client.ts` | Built. `verifyOnChain()` submits to Scroll. |
| Retry queue | `src/lib/core/blockchain/submission-retry-queue.ts` | Built. Exponential backoff for failed on-chain submissions. |
| Submission model | `convex/schema.ts` (`submissions` table) | Built. Has `cwcSubmissionId`, `deliveryStatus`, `deliveryError`, `deliveredAt` — all CWC fields ready but never populated. |
| Template routing | `/api/debates/create` uses `templateId` | Debate→Template relation exists. Campaign→Template via `campaign.templateId`. |
| Officials with CWC codes | resolve-address API | Returns `office_code` (CWC code) per official. |

### What's missing — the gap

The submission handler runs: proof → nullifier check → store → blockchain verify. It **never delivers to Congress**. The CWC HTTP delivery step is completely absent.

CWC (Congress.gov Web Communication) API delivers messages to congressional offices. Each office has a unique CWC code (returned as `cwc_code`/`office_code` from the officials lookup). The delivery flow should be:

1. After blockchain verification succeeds (`verificationStatus: 'verified'`), trigger CWC delivery
2. Decrypt the message in TEE (the `encryptedMessage` field on `submissions`)
3. POST to CWC API with: recipient office code, message body, sender district, metadata
4. Update `cwcSubmissionId`, `deliveryStatus`, `deliveredAt`

### Wiring instructions (Task #3)

**Create `src/lib/core/congressional/cwc-delivery.ts`:**

```typescript
interface CWCDeliveryParams {
    submissionId: string;
    recipientCwcCode: string;
    districtId: string;          // "CA-12"
    messageBody: string;         // Decrypted in TEE
    senderPrefix: string;        // "A verified constituent of CA-12"
    topic?: string;              // Bill number or topic
}

interface CWCDeliveryResult {
    success: boolean;
    cwcSubmissionId?: string;
    error?: string;
}
```

**Delivery trigger:** Add a `deliverToCongress()` call inside `queueBlockchainSubmission()` after the `verificationStatus: 'verified'` patch (submission-handler.ts:167-179). This keeps delivery gated behind proof verification.

```typescript
// After line 179 in submission-handler.ts:
if (result.success && result.txHash) {
    // ... existing verified update ...

    // Trigger CWC delivery (fire-and-forget)
    deliverToCongress(submissionId, request).catch(err => {
        console.error('[SubmissionHandler] CWC delivery error:', err);
    });
}
```

**Template → district routing:** When a campaign has `targets[].district` (e.g. `"CA-12"`), the submission handler needs to match the submitter's district (from their ZK proof's public inputs) against the campaign's target districts. Only deliver to offices whose district matches the proven constituency.

**CWC API integration pattern:**
- Endpoint: POST to CWC delivery gateway (env: `CWC_API_URL`, `CWC_API_KEY`)
- CWC expects: office code, delivery ID, topic, message body
- Rate limit: CWC has per-office rate limits. Implement per-office queuing.
- Retry: CWC returns 429/503 → queue for retry using existing `submission-retry-queue.ts` pattern

**Message decryption:** The `encryptedMessage` field contains XChaCha20-Poly1305 ciphertext encrypted to the TEE public key. Decryption must happen inside the TEE. For Phase 1 without TEE: if `encryptedMessage` is undefined, the message was submitted in plaintext via the campaign page form (non-ZK path). Support both:
- ZK path: `encryptedMessage` → TEE decrypt → CWC deliver
- Campaign page path: message from form → stored as `campaignActions.messageHash` → deliver via CWC with plaintext

### Env vars required
- `CWC_API_URL` — CWC delivery gateway endpoint
- `CWC_API_KEY` — API authentication key
- `CWC_RATE_LIMIT_PER_OFFICE` — Max deliveries per office per hour (default: 10)

---

## 3. Debate Market Integration (DEBATE → true)

### What exists

| Layer | File | Status |
|-------|------|--------|
| Debate client (898 lines) | `src/lib/core/wallet/debate-client.ts` | Built. submitArgument, coSign, commitTrade, revealTrade — both wallet-pay and gasless (ERC-4337). |
| DebateSignal component | `src/lib/components/debate/DebateSignal.svelte` | Built. Shows stance bar, LMSR prices, participant count, time remaining. |
| DebateMarketCard component | `src/lib/components/debate/DebateMarketCard.svelte` | Built. Card with price bar, stats, stance counts, epoch info. |
| 23 debate components total | `src/lib/components/debate/` | Built. Full debate UI exists. |
| 13 debate API endpoints | `src/routes/api/debates/` | Built. create, arguments, commit, reveal, cosign, resolve, appeal, evaluate, stream, position-proof, ai-resolution, claim, by-template. |
| Debate page | `src/routes/s/[slug]/debate/[debateId]/` | Built. Full debate participation page. |
| Debate model | `convex/schema.ts` (`debates` table) | Built. Links to Template via `templateId`. LMSR fields, arguments, nullifiers. |
| Campaign model | `convex/schema.ts` (`campaigns` table) | Has `debateEnabled` (default false), `debateThreshold` (default 50). |
| Campaign→Template link | `campaign.templateId` | Exists. Campaign optionally references a Template. |

### What's missing — the gap

The campaign page (`/c/[slug]`) has **no awareness of debates**. The linkage is:

```
Campaign.templateId → Template.id ← Debate.template_id
```

A campaign can have `debateEnabled: true`, and its linked template can have an active debate. But the campaign page doesn't query for this or display debate signals.

### Wiring instructions (Task #4)

**Server (`/c/[slug]/+page.server.ts`):**

Add a debate lookup to the `load` function when `FEATURES.DEBATE` is true:

```typescript
import { FEATURES } from '$lib/config/features';
import { serverQuery } from '$lib/server/convex';
import { api } from '$convex/api';

// Inside load(), after campaign query:
let debate = null;
if (FEATURES.DEBATE && campaign.debateEnabled && campaign.templateId) {
    debate = await serverQuery(api.debates.latestForTemplate, {
        templateId: campaign.templateId,
        topArgumentCount: 5, // Top 5 for signal display
    });
}
```

The Convex query uses `withIndex('by_template', q => q.eq('templateId', templateId))`,
orders by `status asc, createdAt desc`, and returns the matching
`debates` row along with the top-N `debateArguments` ordered by
`weightedScore`. Return `debate` (with any BigInt fields serialised) in the page data.

**Client (`/c/[slug]/+page.svelte`):**

In the 'info' (landing) step, between the social proof bar and the "Take Action" button, conditionally render:

```svelte
{#if FEATURES.DEBATE && data.debate}
    <div class="mt-4">
        <DebateMarketCard
            debateId={data.debate.id}
            propositionText={data.debate.propositionText}
            status={data.debate.status}
            argumentCount={data.debate.argumentCount}
            totalStake={data.debate.totalStake}
            uniqueParticipants={data.debate.uniqueParticipants}
            deadline={data.debate.deadline}
            prices={data.debate.currentPrices}
            argumentStances={buildArgumentStanceMap(data.debate.arguments)}
            href="/s/{data.campaign.orgSlug}/debate/{data.debate.id}"
        />
    </div>
{/if}
```

Also add `DebateSignal` as an inline badge near the campaign title for a compact signal:

```svelte
{#if FEATURES.DEBATE && data.debate}
    <DebateSignal debate={data.debate} variant="compact" />
{/if}
```

**Debate spawning from campaign:** The org dashboard should have a "Create Debate" action on campaigns where `debateEnabled: true` and `templateId` is set. This calls `POST /api/debates/create` with the campaign's `templateId`. The UI for this lives in the org campaign management page (not the public `/c/[slug]` page). This is an org-side feature, not a public-page change.

**Data flow for DebateSignal:** The `DebateSignal` component expects a `DebateData` type from `debateState.svelte`. The page server should shape the query result to match this type, or create a lightweight adapter. Key fields: `status`, `uniqueParticipants`, `currentPrices`, `arguments` (for stance map), `deadline`, `winningStance`.

---

## 4. Cross-Cutting Concerns

### Feature flag coordination

The three flags can be flipped independently:

| Flag | Dependencies | Can flip alone? |
|------|-------------|-----------------|
| `ADDRESS_SPECIFICITY → 'district'` | IDENTITY_SIGNING_KEY env var, Shadow Atlas running | Yes |
| `CONGRESSIONAL → true` | ADDRESS_SPECIFICITY must be 'district' (need real districts for routing), CWC_API_URL/KEY | Requires district |
| `DEBATE → true` | WALLET must also be true (debate requires wallet for staking), Scroll RPC | Requires wallet |

**Flip order:** ADDRESS_SPECIFICITY first, then CONGRESSIONAL, then DEBATE (after WALLET).

DEBATE and CONGRESSIONAL are independent of each other. A campaign can have debates without congressional delivery, and vice versa.

### Rate limiting

New endpoints that need rate limiting:

| Endpoint | Current | Needed |
|----------|---------|--------|
| `/api/location/resolve-address` | Auth required, no explicit rate limit | Add 20 req/min per user (geocoding is expensive) |
| `/api/debates/create` | Tier 3+ gate | Add 5 req/min per user (prevents debate spam) |
| CWC delivery (new) | N/A | Per-office: 10/hour. Per-user: 20/hour total. |
| Campaign action with district | 10/min/IP (existing) | Keep existing limit — district verification doesn't change the rate |

Use existing `getRateLimiter()` from `$lib/core/security/rate-limiter.ts`.

### Billing plan gating

| Feature | Free | Starter | Organization | Coalition |
|---------|------|---------|-------------|-----------|
| District verification | Yes | Yes | Yes | Yes |
| Congressional delivery (CWC) | No | Yes | Yes | Yes |
| Debate markets on campaigns | No | No | Yes | Yes |

Implement in the campaign page server action and debate create endpoint:

```typescript
import { getPlanForOrg } from '$lib/server/billing/plans';

// CWC delivery gating:
const plan = getPlanForOrg(org.subscription);
if (plan.slug === 'free') {
    return fail(403, { error: 'Congressional delivery requires a Starter plan or above.' });
}
```

Debate gating should check `plan.slug` is 'organization' or 'coalition' in the `/api/debates/create` endpoint.

### Workers compatibility

All code must remain CF Workers compatible:

- **No `Buffer`**: Use `Uint8Array` + `TextEncoder` (already done in district-credential.ts)
- **No `fs`/`path`**: All data I/O goes through Convex
- **No `process.env` directly in client code**: Use `$env/dynamic/public` for client, `process.env` only in server paths (populated by `handlePlatformEnv` shim)
- **CWC HTTP client**: Use `fetch()` (globally available on Workers), not axios/node-fetch
- **Ed25519 signing**: Uses `@noble/curves` (pure JS, Workers compatible) — already correct
- **No DB clients in module scope**: call Convex via `serverQuery` / `serverAction` / `serverMutation` at request time.

### Environment variables summary

Existing (already needed):
- `IDENTITY_SIGNING_KEY`, `IDENTITY_HASH_SALT`, `DISTRICT_HASH_SALT`
- `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`

New for Tier 1:
- `CWC_API_URL` — CWC delivery gateway
- `CWC_API_KEY` — CWC authentication
- `SCROLL_RPC_URL` — Scroll blockchain RPC (for debate, may already exist as `PUBLIC_SCROLL_RPC_URL`)

---

## 5. Task Assignment Summary

| Task | What to do | Key files to modify |
|------|-----------|-------------------|
| **#2** Wire district verification | Replace postal code with AddressCollectionForm on campaign page when district mode. Thread district code through form submission. Hash district instead of postal. Upgrade engagement tier. | `+page.svelte`, `+page.server.ts` in `/c/[slug]/`, `AddressCollectionForm.svelte` (add district to callback) |
| **#3** Wire CWC delivery | Create `cwc-delivery.ts`. Add delivery trigger in submission-handler after blockchain verification. Add CWC rate limiting. | `submission-handler.ts`, new `cwc-delivery.ts`, `/api/congressional/submit/` (if endpoint needed) |
| **#4** Integrate debate markets | Add debate query to campaign page server load. Render DebateMarketCard + DebateSignal on campaign landing. Shape data for component types. Add debate spawning action to org dashboard. | `+page.svelte`, `+page.server.ts` in `/c/[slug]/` |
| **#5** Flip flags | Set ADDRESS_SPECIFICITY='district', CONGRESSIONAL=true, DEBATE=true in features.ts. Gate CONGRESSIONAL behind plan check. Gate DEBATE behind plan + WALLET check. Add rate limits to new endpoints. | `features.ts`, billing checks in relevant endpoints |
