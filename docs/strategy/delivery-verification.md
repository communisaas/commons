# Email Verification (TEE-Based Privacy-Preserving Verification)

**Status**: Phased Implementation
**Current Phase**: Phase 1 partially scaffolded, not shipped end-to-end (reconciled 2026-04-23)
**Future Phases**: Phase 2-4 illustrative (TEE verification, congressional signatures, browser-native)

> ⚠️ **DIVERGENCE BANNER (2026-04-23 audit).** This strategy doc
> describes a three-phase vision for cryptographic delivery proof.
> Concrete corrections before trusting any "✅ IMPLEMENTED" markers:
>
> - **Phase 1 OAuth persistence is NOT shipped end-to-end.**
>   Encryption primitives exist in `src/lib/core/auth/oauth-token-encryption.ts`,
>   but **no Convex schema fields** store `encryptedOauthTokens`,
>   `oauthProvider`, `oauthExpiresAt`. OAuth is currently used for
>   SvelteKit-session sign-in only; tokens aren't persisted for
>   post-send verification. Downgrade Phase 1 to "Scaffolded."
> - **Phase 2 TEE email verification is illustrative.** No AWS Nitro
>   deployment. Active resolver is `LocalConstituentResolver`
>   (in-process decryption in the CF Worker). `verifyEmailDelivery()`
>   referenced below (~lines 113-167) does not exist in the codebase.
>   Gmail OAuth search, 5–10 s TEE turnarounds, and attestation
>   properties (attestation, hypervisor, memory encryption, secure
>   deletion) are **desired** properties, not implemented.
> - **Phase 3 Congressional signatures:** delivery code in
>   `convex/submissions.ts` + `convex/_cwcXml.ts` exists for CWC, but
>   **`FEATURES.CONGRESSIONAL=false`** — UI gated off. House delivery
>   requires `GCP_PROXY_URL` + `GCP_PROXY_AUTH_TOKEN` per
>   `docs/adr/WP-008-house-cwc-delivery-fix.md`.
> - **Accountability receipt "badge" end-to-end is overstated.**
>   `accountabilityReceipts` foundation shipped; Phase 2 scorecard +
>   Phase 3 Scroll L2 anchor are partial (see ACCOUNTABILITY-RECEIPT
>   banner). Scorecard compute is a log-only stub in
>   `convex/legislation.ts`.
> - **Verification page path is `/verify/[hash]`**
>   (`src/routes/verify/[hash]/+page.server.ts`) with lookup order:
>   (1) `deliveryId` → `campaignDeliveries`, (2) `campaignId` →
>   `campaigns` (legacy), (3) district credential hash (legacy).
>   Doc should enumerate this.

> **Implementation Status Overview**:
> - **Phase 1 (OAuth)**: ✅ IMPLEMENTED - Token persistence, encrypted storage, revocation
> - **Phase 2 (TEE verification)**: 🔮 FUTURE - AWS Nitro Enclaves, zero-knowledge email proofs
> - **Phase 3 (Congressional signatures)**: 🔮 FUTURE - Requires congressional office adoption
> - **Phase 4 (Browser-native)**: 🔮 FUTURE - Client-side WASM proving (12-18 months)

---

## Problem Statement

Users need to prove they sent congressional messages for reputation tracking, but traditional email verification methods violate cypherpunk privacy principles:

**❌ Insecure approaches**:
- Reading sent folder directly → privacy violation, requires full email access
- Server-side email parsing → centralized data collection, trust requirement
- Manual screenshots → easily forged, not cryptographically verifiable

**✅ Cypherpunk requirement**: Verify message delivery without reading email content or storing plaintext credentials.

---

## Privacy-Preserving Verification Architecture

### Core Principle: Zero-Knowledge Proof of Delivery

**What we verify**: "This user sent a message to this congressional office at this time"

**What we DON'T see**: Email content, sender name, recipient details (beyond congressional office)

**How**: TEE-based email verification with OAuth persistence

---

## Phase 1: OAuth Token Persistence ✅ IMPLEMENTED

**Current implementation**:
```typescript
// User grants OAuth access once
const { tokens } = await oauth2Client.getToken(code);

// Tokens stored encrypted server-side
await ctx.db.patch(user._id, {
  encryptedOauthTokens: encryptTokens(tokens),
  oauthProvider: 'google',
  oauthExpiresAt: tokens.expiry_date
});
```

**User experience**:
- Grant OAuth access once
- Tokens persist until user revokes
- Enables convenient re-verification without repeated auth flows

**Privacy**: Tokens encrypted with user-specific key, user can revoke anytime

---

## Phase 2: TEE-Based Email Verification 🔮 FUTURE

### Architecture

**Flow**:
```
1. User submits message through Commons
   → Message ID stored in database
   → Expected delivery time recorded

2. After 5-15 minutes (email delivery time):
   → User clicks "Verify Delivery" button
   → Frontend triggers verification API endpoint

3. Server sends verification request to TEE:
   → OAuth tokens decrypted
   → TEE receives encrypted tokens + message ID
   → TEE uses AWS Nitro Enclaves (hypervisor-isolated)

4. TEE email verification:
   → TEE decrypts OAuth tokens in secure memory
   → TEE connects to Gmail API via OAuth
   → TEE searches sent folder for message ID
   → TEE generates zero-knowledge proof: "Message X sent at time T"
   → TEE deletes OAuth tokens from memory (5-10s window)
   → TEE returns proof to server

5. Server verification:
   → Verify ZK proof cryptographically
   → Update user reputation on-chain (ERC-8004)
   → Store proof hash (not email content)
   → Return verification badge to user
```

**Privacy guarantees**:
- OAuth tokens exist in TEE memory for 5-10 seconds only
- TEE never persists email content
- Proof reveals delivery fact, not message content
- Server receives proof hash, not email data
- User can revoke OAuth access anytime

### TEE Implementation Details

**AWS Nitro Enclaves** (ARM Graviton, hypervisor-isolated):
```typescript
// Inside TEE (runs in AWS Nitro Enclave)
export async function verifyEmailDelivery(
  encryptedTokens: string,
  messageId: string,
  congressionalOffice: string
): Promise<DeliveryProof> {
  // 1. Decrypt OAuth tokens (in TEE secure memory)
  const tokens = await decryptInTEE(encryptedTokens);

  // 2. Connect to Gmail API
  const gmail = new Gmail({ credentials: tokens });

  // 3. Search sent folder for message
  const sentMessages = await gmail.users.messages.list({
    userId: 'me',
    q: `in:sent to:${congressionalOffice} after:${yesterday()}`
  });

  // 4. Find matching message
  const message = sentMessages.messages.find(m =>
    m.id === messageId || m.threadId === messageId
  );

  if (!message) {
    throw new Error('Message not found in sent folder');
  }

  // 5. Generate zero-knowledge proof
  const proof = await generateProof({
    publicInputs: {
      congressionalOffice: hash(congressionalOffice),
      timestamp: message.internalDate,
      messageExists: true
    },
    privateWitness: {
      messageId: message.id,
      senderId: tokens.email,
      fullMessage: message.payload // Never leaves TEE
    }
  });

  // 6. CRITICAL: Delete tokens and message from TEE memory
  secureDelete(tokens);
  secureDelete(message);

  // 7. Return only the proof (no email content)
  return {
    proof: proof.proofBytes,
    publicInputs: {
      congressionalOffice: hash(congressionalOffice),
      timestamp: message.internalDate,
      verified: true
    },
    proofHash: hash(proof.proofBytes)
  };
}
```

**Security properties**:
- TEE attestation proves code integrity (AWS Nitro cryptographic attestation)
- Hypervisor isolation (ARM Graviton, no Intel ME/AMD PSP backdoors)
- Memory encryption (AES-256-XTS)
- Secure deletion (overwrite memory before exit)
- No network access during proving (airgapped verification)

---

## Phase 3: Congressional Email Signatures 🔮 FUTURE

**Better approach** (when congressional offices adopt):

Instead of reading user's sent folder, congressional offices sign delivery receipts:

```typescript
// Congressional office email server returns signed receipt
const deliveryReceipt = {
  messageId: '...',
  recipientOffice: 'sen-warren@senate.gov',
  deliveredAt: '2025-11-09T14:32:00Z',
  signature: sign(privateKey, hash(messageId + deliveredAt))
};

// User presents receipt to Commons
// Commons verifies signature against congressional office public key
// No TEE needed, cryptographically verifiable delivery
```

**Advantages**:
- No OAuth access needed
- No TEE email verification
- Cryptographically verifiable by anyone
- Congressional offices control verification

**Blocker**: Requires congressional offices to implement email signing (advocacy needed)

---

## Phase 4: Browser-Native Verification 🔮 FUTURE

**Ultimate goal**: Client-side email verification with no server access

**Approach**:
```typescript
// Runs entirely in browser
// Uses WebAuthn + Gmail API + browser WASM proving
const proof = await generateProofInBrowser({
  emailProvider: 'gmail',
  messageId: '...',
  userConsentRequired: true // Browser prompts for OAuth consent
});

// Proof generated in browser, submitted to smart contract
// No server sees email content or OAuth tokens
```

**Advantages**:
- Zero server trust required
- User maintains full control
- Browser-native security (WebAuthn)
- WASM-based proving (no TEE needed)

**Blockers**:
- Browser WASM Barretenberg proving is slow (30-60s vs 2-5s in TEE)
- Gmail API CORS restrictions
- UX complexity (users must understand browser proving)

**Timeline**: 12-18 months (browser WASM proving needs optimization)

---

## Implementation Checklist

### Phase 1: OAuth Persistence ✅ COMPLETE
- [x] OAuth integration (Google, Facebook, Twitter, LinkedIn, Discord)
- [x] Encrypted token storage
- [x] Token refresh logic
- [x] User revocation flow

### Phase 2: TEE Email Verification 🔮 FUTURE (6-8 weeks)
- [ ] TEE email verification module (`src/lib/core/tee/email-verifier.ts`)
- [ ] AWS Nitro Enclave deployment configuration
- [ ] Gmail API integration in TEE
- [ ] Noir proof generation for email delivery
- [ ] Verification API endpoint (`/api/verify-delivery`)
- [ ] Frontend verification UI component
- [ ] Integration tests (mocked TEE)
- [ ] Security audit (TEE code review)

### Phase 3: Congressional Email Signatures 🔮 FUTURE (Advocacy Timeline)
- [ ] Draft email signing specification
- [ ] Congressional office outreach
- [ ] Pilot program with 1-2 offices
- [ ] Public key infrastructure for offices
- [ ] Verification client implementation
- [ ] Documentation for congressional IT teams

### Phase 4: Browser-Native Verification 🔮 FUTURE (12-18 months)
- [ ] Browser WASM Barretenberg optimization
- [ ] WebAuthn integration
- [ ] Gmail API CORS workaround
- [ ] Browser proving UI/UX design
- [ ] Security audit (client-side proving)
- [ ] Performance benchmarking (target: <10s proving)

---

## Cost Analysis

### TEE Email Verification (Phase 2)

**AWS Nitro Enclave costs**:
- Instance: `m6g.medium` ARM Graviton ($0.038/hour)
- Storage: 10 GB EBS ($1/month)
- Network: Minimal (OAuth + Gmail API calls)

**Per verification**:
- TEE runtime: 5-10 seconds
- Cost per verification: ~$0.0001 (negligible)
- Monthly cost (1,000 verifications): ~$0.10

**Gmail API costs**: Free (OAuth quota: 10,000 requests/day)

**Total monthly cost** (1,000 verifications): **$0.10 + $38 (instance uptime) = $38.10**

**Optimization**: Batch verifications, shutdown TEE when idle

---

## Privacy Comparison

| Approach | Server Sees Tokens | Server Sees Email | TEE Required | User Effort |
|----------|-------------------|------------------|-------------|-------------|
| **Direct sent folder access** | ✅ Yes | ✅ Yes | ❌ No | Low |
| **Server-side parsing** | ✅ Yes | ✅ Yes | ❌ No | Low |
| **TEE verification (Phase 2)** | ❌ No (encrypted) | ❌ No | ✅ Yes | Low |
| **Congressional signatures (Phase 3)** | ❌ No | ❌ No | ❌ No | Low |
| **Browser-native (Phase 4)** | ❌ No | ❌ No | ❌ No | Medium |

**Winner**: Congressional signatures (Phase 3) - zero server access, cryptographically verifiable

**Interim solution**: TEE verification (Phase 2) - privacy-preserving until congressional offices adopt signatures

---

## User Experience

### Phase 1: OAuth Grant (One-Time)
```
1. User clicks "Connect Gmail" button
2. Google OAuth consent screen
3. User approves access to "Read sent messages"
4. Tokens encrypted and stored
5. User can revoke access anytime in settings
```

### Phase 2: Verification Flow
```
1. User sends congressional message via Commons
2. After 5-15 minutes, "Verify Delivery" button appears
3. User clicks button → triggers TEE verification
4. 5-10 second verification (TEE email search + proof generation)
5. Badge appears: "✅ Verified Delivery"
6. Reputation updated on-chain (+1 message verified)
```

### Phase 3: Congressional Signature Flow (Future)
```
1. User sends message
2. Congressional office email server auto-signs receipt
3. User receives signed receipt in email
4. User uploads receipt to Commons (or auto-detected)
5. Instant verification (signature check)
6. Badge appears: "✅ Cryptographically Verified"
```

---

## Security Considerations

### Threat Model

**Threat 1**: Malicious server operator reads OAuth tokens
- **Mitigation**: Tokens encrypted with user-specific key derived from password
- **Mitigation**: TEE never returns plaintext tokens to server
- **Mitigation**: User can revoke OAuth access anytime

**Threat 2**: TEE compromise (memory dump, side-channel)
- **Mitigation**: AWS Nitro attestation proves TEE integrity
- **Mitigation**: Secure memory deletion after proving
- **Mitigation**: Hypervisor isolation (ARM Graviton, no Intel ME backdoors)

**Threat 3**: Forged verification proofs
- **Mitigation**: UltraHonk/Noir zero-knowledge proofs are cryptographically secure
- **Mitigation**: Proof verification on-chain (public verifiability)
- **Mitigation**: TEE attestation prevents proof forgery

**Threat 4**: User email account compromise
- **Mitigation**: OAuth revocation in Commons settings
- **Mitigation**: Google account security (2FA, passkeys)
- **Mitigation**: Email verification is reputation-gated (sybil resistance)

---

## Cross-References

**TEE architecture** → See `/docs/architecture/tee.md`

**OAuth integration** → See `/docs/features/oauth.md`

**Zero-knowledge proofs** → See `/docs/specs/zk-proof-integration.md`

**Congressional delivery** → See `/docs/congressional/delivery.md`

**Reputation tracking** → See `/docs/integration.md` (VOTER Protocol)

---

## Next Steps

**Phase 2 implementation** (6-8 weeks):
1. TEE email verification module
2. AWS Nitro Enclave deployment
3. Gmail API integration
4. Noir proof generation
5. Frontend UI + API endpoint
6. Integration tests + security audit

**Phase 3 advocacy** (timeline unknown):
1. Draft email signing specification
2. Congressional office outreach
3. Pilot program

**Phase 4 research** (12-18 months):
1. Browser WASM Barretenberg optimization
2. WebAuthn integration
3. Performance benchmarking
