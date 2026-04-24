# Graduated Trust Architecture

> **Status:** Active architecture document (February 2026 — audited 2026-04-23)
> **Supersedes:** The binary verified/unverified model across all identity documentation
> **Audience:** Implementation agents, code reviewers, the author at 3am
>
> **⚠️ Known divergences from implementation (verified against `main`, 2026-04-23):**
> - **Tier 4 (Passport) is unreachable.** `deriveAuthorityLevel()` (`src/lib/core/identity/authority-level.ts:45-64`) has no `document_type === 'passport'` branch: it returns 5 for mDL, falls through to `identity_commitment + trust_tier>=3` → 3, never 4. Tier 4 exists in the labels table and in this doc, but no user will actually derive it. Either retire the tier or add the branch.
> - **Passkey does nothing for tier derivation.** `deriveTrustTier()` accepts `passkey_credential_id` in its input object but never consults it (`authority-level.ts:89-121`). `FEATURES.PASSKEY = false` (`src/lib/config/features.ts:79`), and no UI path invokes `PasskeyRegistration.svelte`. The "Tier 1 Passkey ✅" cycle entry further down in this doc overstates readiness.
> - **Authority Level 2 and Trust Tier 2 are not aligned.** Authority Level 2 is gated on `trust_score >= 100`, but the Tier 2 (District Verified) flow sets `district_verified` / `address_verified_at` and does not bump `trust_score`. A correctly address-verified user will typically land on Authority Level 1, not 2.
> - **No Veriff / phone-verification layer exists.** Earlier drafts of this spec referenced a Veriff phone path; no Veriff integration is present in `src/lib/core/identity/`. Treat any Veriff mentions as aspirational.
> - **Plaintext address fields on the User type.** `convex/schema.ts` no longer stores `street`/`city`/`state`/`zip`, but `src/lib/types/user.ts` still declares `street?` and `zip?`. No active DB PII violation, but the type contract is stale.

---

## Premise

Commons currently presents users with a cliff: either you're unverified (email path, zero signal) or you've scanned your passport in a TEE-backed ceremony (CWC path, full ZK proof). There is nothing in between.

This is architecturally wrong. Trust is not binary. A constituent who provides their address and verifies it against civic data is more credible than an anonymous emailer, even without a passport scan. A user with a persistent passkey-bound identity is more credible than a throwaway session.

The graduated trust model replaces the cliff with a ramp. Each tier costs the user progressively more effort but buys progressively more credibility with the recipient. Users accumulate trust. The system never forgets what they've proven.

---

## The Tiers

```
Tier 0   Guest                     No account, anonymous browsing
Tier 1   Authenticated             OAuth login, persistent pseudonym
Tier 2   District Verified         Address-attested, district confirmed via civic data
Tier 3   Identity Verified         ID card / drivers license verified
Tier 4   Passport Verified         NFC passport (legacy — Didit/self.xyz providers)
Tier 5   Government Verified       mDL / EUDIW via Digital Credentials API
```

Each tier is strictly additive. A Tier 3 user has everything Tier 2 has, plus identity verification. A Tier 5 user has government-backed credential on top of everything below. You never lose a tier — you level up.

> **Note**: Tier 4 (Passport Verified) exists for backward compatibility with users verified through removed providers (Didit, self.xyz). New users progress directly from Tier 3 to Tier 5 via mDL.

### Authority Levels (ZK Circuit Input)

Trust tiers (0-5) are the user-facing concept. Authority levels (1-5) are the on-chain/circuit concept — stored as `authorityLevel` in ZK proof inputs and validated by the circuit (`assert(authority_level >= 1 && authority_level <= 5)`).

| Trust Tier | Authority Level | Derivation |
|---|---|---|
| 0 (Guest) | — | No circuit input (not authenticated) |
| 1 (Authenticated) | 1 | OAuth login, no verification |
| 2 (District Verified) | 2 | `trust_score >= 100` (verified email) |
| 3 (Identity Verified) | 3 | `identity_commitment` present (ID card/license) |
| 4 (Passport Verified) | 4 | `identity_commitment` + `document_type === 'passport'` (legacy) |
| 5 (Government Verified) | 5 | `document_type === 'mdl'` + `identity_commitment` |

**Implementation**: `deriveAuthorityLevel()` and `deriveTrustTier()` in `src/lib/core/identity/authority-level.ts`. Each action domain can require a minimum authority level via `DistrictGate.actionDomainMinAuthority` on-chain.

---

## The Template Link: Primary Trust Graduation Surface

Most users encounter Commons through a shared template link (`/s/[slug]`). This is where trust graduation happens — not in a settings page, not in a profile flow, but in the moment someone wants to take civic action. The template link is the ramp.

### Design principle: action first, trust graduation after

Never gate the primary action (sending a message) behind trust requirements. Let the user send at whatever tier they're at. Then show them the delta — what their message would gain with the next tier.

A Tier 0 guest clicking "Send to Decision-Makers" opens their mail app. That's correct. The mail app IS the Tier 0 action. The graduated trust ramp is what happens around it: the trust signal below the send button, the celebration screen's upgrade CTA, the social proof showing how many verified constituents have already sent.

### What happens at each tier when someone hits a template link

```
Tier 0 → Landing page → "Send" → mailto: opens mail app → "Did you send it?" → celebration + "Create account" CTA
Tier 1 → Landing page → "Send" → (congressional? address gate) → mailto: → celebration + "Verify address" CTA
Tier 2 → Landing page → "Send" → email_attested (district attestation footer) → celebration + "Verify identity" CTA
Tier 3 → Landing page → "Send as Verified Constituent" → ZK proof generation → CWC submission → delivery tracking
Tier 4 → Same as Tier 3, passport-backed authority level (legacy providers only)
Tier 5 → Same as Tier 3, government-backed authority level (mDL / EUDIW)
```

### The delta that matters

Congressional offices process thousands of messages. The signal hierarchy:

| Tier | Delivery | What the office sees | Typical handling |
|------|----------|---------------------|-----------------|
| 0 | Raw email | Unknown sender, no verification | Bulk-counted or ignored |
| 1 | Same email | Same — OAuth doesn't add signal | Same as Tier 0 |
| 2 | Email + attestation | "Verified constituent of [District]" with verification link | Read by staff, logged as constituent contact |
| 3-5 | CWC official channel | Cryptographic proof of district, delivered through official intake | Highest priority, enters casework system |

The jump from Tier 0 to Tier 2 is the highest-ROI graduation. Address entry takes 10 seconds. The user goes from "unknown sender" to "verified constituent." Tier 3 adds cryptographic guarantees and anonymous delivery, but the recipient-facing signal improvement is smaller than 0→2.

### Where trust graduation appears in the template flow

**Before send:** The `ActionBar` trust signal shows current tier and what the next tier unlocks. This is not a nag — it's an honest description of how the message will be received.

**During send (Tier 0-2):** The `mailto:` flow is identical across tiers. The difference is the email content — Tier 2 includes a verifiable district attestation link in the footer.

**During send (Tier 3+):** The `ProofGenerator` replaces the mailto flow. The user sees proof generation progress, then delivery tracking. This is a qualitatively different experience — the interface shifts from "open your mail app" to "we're delivering this through official channels."

**After send:** The celebration screen is the primary trust graduation surface. The user just took an action they care about. They're emotionally invested. This is when "Your message was sent as an unverified email. Verify your address to send as a confirmed constituent (10 seconds)" actually converts.

### What this means for implementation

1. **Tier 0 is correct as-is.** Opening the mail app is the right action. Don't add friction.
2. **The trust signal in ActionBar needs to become dynamic** (currently static disclaimer text). See [UI Trust Signal Integration](#ui-trust-signal-integration).
3. **The celebration screen is under-leveraged.** It currently shows share options. It should also show the tier delta: what the user gained, what they'd gain at the next tier.
4. **Congressional templates at Tier 0-1 should still work via mailto.** The address gate for congressional templates (currently blocks Tier 1 users until they provide an address) is correct — it's the Tier 1→2 graduation happening inline. But it should be framed as "strengthen your message" not "required to send."
5. **The `analyzeEmailFlow()` function in emailService.ts is the routing brain.** It determines which tier's delivery path to use. This is where graduated trust becomes operational code.

### Route and component mapping

| Flow stage | Component | Trust-relevant behavior |
|-----------|-----------|------------------------|
| Landing | `/s/[slug]/+page.svelte` | Social proof metrics, trust-tier-aware CTA text |
| Action | `ActionBar.svelte` | Dynamic trust signal, delivery method preview |
| Modal | `TemplateModal.svelte` | Tier routing via `analyzeEmailFlow()` |
| Address gate | `AddressCollectionForm.svelte` | Tier 1→2 inline graduation, `zk_eligible` warning |
| Email send | `emailService.ts:launchEmail()` | Mailto generation, attestation footer for Tier 2 |
| ZK send | `ProofGenerator.svelte` | Tier 3+ proof generation, `onreverify` for expired credentials |
| Delivery | `SubmissionStatus.svelte` | Tier 3+ CWC delivery tracking |
| Celebration | `TemplateModal.svelte` (celebration state) | Upgrade CTA to next tier |

---

## Tier 0: Anonymous Guest

### Definition

Unauthenticated user. No account, no identity, no binding.

### Current state: IMPLEMENTED

This is the existing email path. User clicks "Send to Decision-Makers", a `mailto:` link opens their email client. The message has no verifiable provenance.

### What the recipient sees

An email from an unknown address. Indistinguishable from spam. Congressional offices deprioritize these. The "Sent via email without cryptographic verification" disclaimer in `ActionBar.svelte` describes this tier honestly.

### What stays

- `mailto:` generation in `emailService.ts:launchEmail()`
- Template viewing without auth
- Personalization text entry

### What changes

- The disclaimer text becomes a dynamic trust signal (see [UI Integration](#ui-trust-signal-integration))
- The disclaimer becomes an affordance: "Create an account to strengthen your message"

### Authority level mapping

`authority_level = 0` (new — currently the schema starts at 1)

### Files

| File | Change |
|------|--------|
| `src/lib/components/template-browser/parts/ActionBar.svelte` | Dynamic trust signal replacing static disclaimer |
| `src/lib/core/identity/authority-level.ts` | Add level 0 for unauthenticated |

---

## Tier 1: Passkey-Bound Identity

### Definition

User has created an account with a WebAuthn passkey. They hold a device-bound (or cloud-synced) asymmetric keypair. The public key derives a `did:key` identifier. This is a persistent pseudonym that survives across sessions and is cryptographically unforgeable.

### Current state: DOES NOT EXIST

The current auth system uses OAuth exclusively (Google, Facebook, Twitter/X, LinkedIn via Arctic library). OAuth provides a session cookie but no cryptographic binding. The user's identity is delegated to Google/Facebook — the platform holds no independent proof that the user is who they claim.

### Why this matters

OAuth identity is **borrowed**. If Google deactivates the account, the identity vanishes. Passkeys give the user **sovereign** control over their cryptographic identity. This is the cypherpunk foundation: you are your key.

Practically: passkeys are phishing-resistant, biometric-gated (FaceID/TouchID), synced across devices (iCloud Keychain, Google Password Manager), and understood by 40%+ of internet users. 95% device support. The UX is strictly better than OAuth for most users.

### Target architecture

```
User creates account
  → Browser generates WebAuthn credential (passkey)
  → Public key extracted from attestation
  → did:key derived: did:key:z6Mk... (multicodec-encoded Ed25519 or P-256 pubkey)
  → Stored: credential ID, public key JWK, did:key string
  → OAuth remains available as FALLBACK (not primary)
  → Existing OAuth users offered passkey upgrade in-app
```

### Schema changes

```ts
// convex/schema.ts — add to users table
users: defineTable({
  // ...existing fields
  passkeyCredentialId: v.optional(v.string()),   // unique
  passkeyPublicKeyJwk: v.optional(v.any()),      // JWK for passkey public key
  didKey: v.optional(v.string()),                // did:key:z6Mk... (unique)
  passkeyCreatedAt: v.optional(v.number()),
  passkeyLastUsedAt: v.optional(v.number()),
})
  .index("by_passkey_credential_id", ["passkeyCredentialId"])
  .index("by_did_key", ["didKey"])
```

### Authority level mapping

`authority_level = 1` (replaces current "OAuth-only" at level 1 — but now with cryptographic backing)

OAuth-only users without passkey: `authority_level = 1` (same number, weaker guarantee — see [Migration](#oauth-to-passkey-migration))

### Implementation scope

**New files to create:**
| File | Purpose |
|------|---------|
| `src/lib/core/identity/passkey-registration.ts` | WebAuthn registration ceremony, credential storage |
| `src/lib/core/identity/passkey-authentication.ts` | WebAuthn authentication, challenge-response |
| `src/lib/core/identity/did-key-derivation.ts` | Derive did:key from WebAuthn public key |
| `src/routes/api/auth/passkey/register/+server.ts` | Server-side registration endpoint (challenge generation, attestation verification) |
| `src/routes/api/auth/passkey/authenticate/+server.ts` | Server-side authentication endpoint |
| `src/lib/components/auth/PasskeyRegistration.svelte` | Registration UI (biometric prompt) |
| `src/lib/components/auth/PasskeyUpgrade.svelte` | Nudge for existing OAuth users to add passkey |

**Files to modify:**
| File | Change |
|------|---------|
| `src/hooks.server.ts` | Add passkey session validation alongside cookie auth |
| `src/lib/core/identity/authority-level.ts` | Distinguish passkey (L1 strong) from OAuth-only (L1 weak) |
| `src/lib/services/emailService.ts` | Include did:key in message metadata for Tier 1+ users |
| `convex/schema.ts` | Add passkey fields to `users` table |

### Dependencies

- `@simplewebauthn/server` (server-side WebAuthn) — mature, well-maintained
- `@simplewebauthn/browser` (client-side WebAuthn) — handles navigator.credentials API
- No blockchain dependency. No wallet. No seed phrase.

### Security considerations

**Key sync risk:** Cloud-synced passkeys (iCloud Keychain, Google Password Manager) mean Apple/Google can theoretically access the private key. For Tier 1 this is acceptable — the threat model is phishing and account takeover, not nation-state surveillance. Tier 3 adds ZK proofs for the surveillance-resistant layer.

**Recovery:** If user loses all devices, passkey is lost. Recovery path: linked OAuth provider serves as fallback authentication, user re-registers passkey. The did:key changes — this is acceptable at Tier 1. Tier 3's identity_commitment (derived from government document) is device-independent and survives device loss.

**Account linking:** When a user adds a passkey to an existing OAuth account, the did:key is derived fresh. When they later authenticate via passkey, the session resolves to the same User record. The OAuth link remains as recovery.

### What this obsoletes

- `docs/specs/coinbase-auth-integration.md` — KYC-verified OAuth is less valuable than passkeys + address attestation. The spec describes adding Coinbase as an OAuth provider for its KYC status. Passkeys provide stronger cryptographic binding without the platform dependency. **Archive this spec.**
- The `trust_score` concept derived from OAuth provider quality (Google=80, LinkedIn=80, Facebook=70, Twitter=50) — this becomes less relevant when passkeys provide a uniform cryptographic baseline. Keep the field for backward compatibility but stop deriving authority from it.

---

## Tier 2: Address-Attested

### Definition

User has provided a residential address that has been verified against civic data to map to a specific representative's district. A verifiable credential for district residency is issued and stored client-side. The address itself is NOT stored on the platform after verification — only the district and the credential metadata.

### Current state: PARTIALLY EXISTS, CONFLATED WITH TIER 3

The `AddressRequirementModal` + `address-steps/` components collect an address and look up representatives. But this flow is currently **bundled with the full identity verification ceremony** — you can't get address attestation without also doing a passport/ID scan. This bundling is the source of the cliff.

Additionally, the User model stores plaintext address fields (`street`, `city`, `state`, `zip`) which contradicts the privacy architecture documented everywhere.

### Why this tier matters most

Congressional offices care about one thing: **is this person my constituent?** A verified address answers that question. You don't need a passport scan to prove you live somewhere. The passport scan proves you're a unique human (Sybil resistance) — that's Tier 3. Tier 2 proves geographic membership, which is what the recipient actually needs.

This tier converts the largest number of users. Address entry takes 10 seconds. The civic data API call takes <1 second. The user goes from zero signal to "verified constituent of your district" with almost no friction.

### Target architecture

```
User provides address (street, city, state, zip)
  → Server calls civic data API (Census geocoder + representative lookup)
  → Response: congressional district, state legislature districts, representatives
  → Server verifies address maps to target template's jurisdiction
  → Server issues a Verifiable Credential (W3C VC 2.0):
      {
        "@context": ["https://www.w3.org/ns/credentials/v2"],
        "type": ["VerifiableCredential", "DistrictResidencyCredential"],
        "issuer": "did:web:commons.email",
        "credentialSubject": {
          "id": <user's did:key from Tier 1>,
          "districtMembership": {
            "congressional": "CA-12",
            "stateSenate": "CA-SD-11",
            "stateAssembly": "CA-AD-17"
          }
        },
        "issuanceDate": "...",
        "expirationDate": "..." // 90 days
      }
  → VC signed with platform key (Ed25519 or P-256)
  → VC stored client-side in IndexedDB (same store as Shadow Atlas credentials)
  → Address CLEARED from server after district derivation
  → User model updated: district_verified=true, address_verified_at=now()
```

**Optional postal verification loop** (higher assurance):
```
Server generates 6-digit code → mailed to address via USPS
  → User enters code within 14 days
  → VC reissued with verification_method: 'postal'
  → authority_level bumped to 2.5 (between civic_api and government_id)
```

### Schema changes

```ts
// convex/schema.ts — add to users table
users: defineTable({
  // ...existing fields
  addressVerificationMethod: v.optional(v.string()), // 'civic_api' | 'postal' | 'mdl'
  addressVerifiedAt: v.optional(v.number()),
  // Existing districtVerified boolean is retained but now means "Tier 2+ achieved"
  // Existing congressionalDistrict field is retained for server-side routing
})

// NEW: Track issued VCs
districtCredentials: defineTable({
  userId: v.id("users"),
  credentialType: v.string(), // default: "district_residency"
  congressionalDistrict: v.string(),
  stateSenateDistrict: v.optional(v.string()),
  stateAssemblyDistrict: v.optional(v.string()),
  verificationMethod: v.string(),   // 'civic_api' | 'postal'
  issuedAt: v.number(),
  expiresAt: v.number(),            // 90 days from issuance
  revokedAt: v.optional(v.number()),
  credentialHash: v.string(),       // SHA-256 of the VC for integrity check
})
  .index("by_user_expires", ["userId", "expiresAt"])
  .index("by_district", ["congressionalDistrict"])
```

### Plaintext address fields: DEPRECATION REQUIRED

The `users` table currently has:
```ts
city: v.optional(v.string()),
state: v.optional(v.string()),
street: v.optional(v.string()),
zip: v.optional(v.string()),
```

These fields store PII in plaintext. They violate the privacy guarantees documented in `docs/design/patterns/identity-verification.md` ("Your address never leaves this device") and the `convex/schema.ts` comment ("Address verified once via TEE, cached as session credential, then destroyed").

**Migration plan:**
1. Address fields remain temporarily for Tier 2 address collection
2. After district derivation + VC issuance, address fields are **nullified** on the server
3. A background job clears any lingering plaintext addresses older than 24 hours
4. Long-term: remove the columns entirely, derive district only from VC or Shadow Atlas

### Authority level mapping

`authority_level = 2` (address-attested via civic data)
`authority_level = 2` with postal verification (same level, but `address_verification_method = 'postal'` for higher-assurance contexts)

### Implementation scope

**Files to create:**
| File | Purpose |
|------|---------|
| `src/lib/core/identity/district-credential.ts` | VC issuance, signing, storage, presentation |
| `src/lib/core/identity/address-verification.ts` | Civic data API integration, district derivation |
| `src/lib/core/identity/credential-store.ts` | IndexedDB wrapper for client-side VC storage (unify with existing Shadow Atlas store) |
| `src/routes/api/identity/verify-address/+server.ts` | Address verification endpoint (replaces current ad-hoc address handling) |

**Files to refactor:**
| File | Change |
|------|--------|
| `src/lib/components/auth/address-steps/AddressForm.svelte` | Unbundle from identity verification flow. Make independently accessible. |
| `src/lib/components/auth/address-steps/AddressVerification.svelte` | Show VC issuance confirmation, not just rep lookup |
| `src/lib/components/auth/IdentityVerificationFlow.svelte` | Make Tier 2 (address) a standalone step, not bundled with Tier 3 (passport) |
| `src/lib/services/emailService.ts` | Add Tier 2 delivery path: email with district attestation |
| `src/lib/core/identity/credential-policy.ts` | Add TTL for district credentials (90 days), distinguish from identity credentials (30 days) |
| `src/lib/core/identity/authority-level.ts` | Add Tier 2 derivation (district_verified + address_verified_at) |

**Files to deprecate (long-term):**
| File | Reason |
|------|--------|
| User model `street`, `city`, `state`, `zip` columns | PII in plaintext; violates privacy architecture |

### Credential TTL integration

The existing `credential-policy.ts` already defines action-based TTLs:

```
view_content:          6 months
community_discussion:  3 months
constituent_message:   30 days
official_petition:     7 days
```

For Tier 2, the district credential itself has a 90-day TTL. The action-based TTL applies ON TOP — a constituent_message requires the district credential to be less than 30 days old, even though the credential itself is valid for 90 days. This means Tier 2 users who want to send constituent messages need to re-verify their address every 30 days.

This is correct behavior: ~2% of the population moves annually, and the 30-day window for high-stakes actions limits stale-district attacks.

### What this unbundles from Tier 3

Currently, the `IdentityVerificationFlow.svelte` component has three steps:
1. Value proposition
2. Verification (mDL via Digital Credentials API — sole active provider)

> **Note (Cycle 15):** NFC passport (self.xyz) and Government ID (Didit.me) method selection has been removed. mDL is the only active verification path.

Tier 2 inserts a new path BEFORE step 2: "Just verify your address" → address form → civic data check → VC issued → done. The user can stop here. The identity verification ceremony (step 2) becomes an OPTIONAL upgrade to Tier 3.

---

## Tier 3: ZK-Verified Constituent

### Definition

User has verified their identity with a government credential (mDL / EUDIW via Digital Credentials API). Their identity commitment (Poseidon2 hash) is registered in the Shadow Atlas Merkle tree. They can generate zero-knowledge proofs of district membership without revealing their identity. Messages are witness-encrypted to the TEE public key and delivered through the CWC API.

> **Note (Cycle 15):** Previously, Tier 3 supported passport via self.xyz NFC and government ID via Didit.me. These providers have been removed. Identity verification now flows exclusively through the mDL path (Tier 4 Digital Credentials API), which also satisfies Tier 3 requirements.

### Current state: PARTIALLY IMPLEMENTED (estimated ~50%)

**What works:**
- ~~Didit.me identity verification flow (UI + API)~~ (removed — Cycle 15)
- Identity commitment computation (`identity-binding.ts`)
- Authority level derivation (`authority-level.ts`)
- Credential policy with action-based TTL (`credential-policy.ts`)
- Shadow Atlas registration handler (`shadow-atlas-handler.ts`)
- Shadow Atlas API client (`shadow-atlas/client.ts`)
- Convex schema for all Tier 3 models (`shadowAtlasRegistrations`, `submissions`, `encryptedDeliveryData` in `convex/schema.ts`)
- Sybil resistance via identity_hash uniqueness
- Cross-provider deduplication via identity_commitment

**What's missing:**
- ~~self.xyz NFC passport integration~~ (removed — Cycle 15; mDL is the sole verification path)
- Browser-side ZK prover integration (voter-protocol has the prover, Commons hasn't wired it)
- Browser-side witness encryption (XChaCha20-Poly1305 — no libsodium.js integration)
- TEE infrastructure (AWS Nitro Enclave — provider interface exists, deployment missing)
- CWC API submission (client code exists at `cwc-client.ts`, not connected to delivery pipeline)
- On-chain proof verification (Scroll zkEVM — schema fields exist, integration missing)
- Proof generation UX (Svelte 5 proof store referenced in docs but not implemented)

### What's actually legacy at this tier

**`src/lib/core/proof/nitro-enclave-demo.ts`** — Demo/stub code. Replace with real TEE attestation verification.

**`src/lib/core/tee/providers/gcp.ts`** — GCP Confidential Computing provider. **Decision: AWS Nitro Enclaves only.** This is dead code — remove when doing TEE implementation.

### Implementation scope for completion

This is the largest tier. The work breaks into five workstreams:

**Workstream A: Browser ZK Prover Integration**
- Wire voter-protocol's WASM prover into Commons
- Create Svelte 5 reactive proof generation store
- Build witness construction from Shadow Atlas credentials
- UX: progress indicator, error handling, retry

**Workstream B: Witness Encryption**
- Integrate libsodium.js (or tweetnacl) for XChaCha20-Poly1305
- Fetch TEE public key from attestation endpoint
- Encrypt address + message content to TEE key
- Store encrypted blob via EncryptedDeliveryData model

**Workstream C: TEE Infrastructure**
- Deploy AWS Nitro Enclave
- Implement attestation verification
- Key management (enclave-generated keypair, public key distribution)
- Decryption service inside enclave
- CWC API submission from within enclave

**Workstream D: CWC Delivery Pipeline**
- Connect `cwc-client.ts` to delivery pipeline
- Per-representative routing
- Delivery status tracking
- Error handling and retry (SubmissionRetry model)

**~~Workstream E: self.xyz Integration~~** — REMOVED (Cycle 15)
> self.xyz NFC passport provider has been removed. mDL via Digital Credentials API (Tier 4) is the sole active verification path and satisfies Tier 3 requirements.

### Authority level mapping

`authority_level = 3` (government ID / drivers license — legacy values from removed providers)
`authority_level = 4` (passport — legacy value from removed self.xyz provider)
`authority_level = 5` (mDL / EUDIW via Digital Credentials API — ONLY active verification path)

### Security note: privacy profile

Tier 3 is **more private** than Tier 2 despite being higher trust. At Tier 2, the platform knows the user's district (derived from their address). At Tier 3, the platform only knows the user's identity_commitment (a Poseidon2 hash) and their leaf position in a Merkle tree. The ZK proof reveals district membership to the recipient without revealing identity to anyone — not even the platform.

This non-monotonic privacy profile is a feature, not a bug. Document it clearly for users: "Upgrading to verified constituent makes your messages MORE private, not less."

---

## Tier 4: Government Credential

### Definition

User presents a government-issued digital credential (mobile driver's license, national ID, or EUDIW credential) directly through the browser's Digital Credentials API. The credential is verified against the issuing authority. Selective disclosure extracts only the district-relevant information (residential address → district mapping) without exposing full identity.

### Current state: DOES NOT EXIST

### Landscape (February 2026)

- **Digital Credentials API:** Shipped in Chrome 141 (September 2025) and Safari 26 (September 2025). Chrome supports OpenID4VP; Safari supports ISO mdoc.
- **US mDLs:** 18 states issuing, accepted at 250+ TSA checkpoints. ~143M holders projected by 2030.
- **EU EUDIW:** Mandated by November 2026 — all EU member states must offer at least one certified digital identity wallet.
- **Standards:** ISO 18013-5 (mDL), W3C VC 2.0, OpenID4VP.

### Target architecture

```
User clicks "Verify with government ID"
  → Browser calls navigator.identity.get() with Digital Credentials API
  → Phone wallet prompts user to share: residential address (selective disclosure)
  → Credential presented via OpenID4VP or ISO mdoc
  → Server verifies credential signature against issuing state's certificate
  → Address extracted → district derived via civic data API
  → VC issued (same as Tier 2 but with verification_method: 'mdl')
  → Shadow Atlas registration (same as Tier 3)
  → authority_level = 5 (government-issued, highest tier)
```

### Authority level mapping

`authority_level = 5` (government-issued credential — currently reserved in the schema)

### Implementation scope

**New files:**
| File | Purpose |
|------|---------|
| `src/lib/core/identity/digital-credentials-api.ts` | Browser Digital Credentials API integration |
| `src/lib/core/identity/mdl-verification.ts` | mDL credential verification (ISO 18013-5) |
| `src/routes/api/identity/verify-mdl/+server.ts` | Server-side mDL verification endpoint |
| `src/lib/components/auth/GovernmentCredentialVerification.svelte` | UI for mDL/EUDIW presentation |

### Considerations

**Not all users have this.** 18 US states is not 50. EU coverage is broader but not universal until late 2026/2027. This tier is additive — it never replaces Tiers 2 or 3 as the primary path.

**Issuer trust chain:** mDL credentials are signed by the issuing state's DMV. Verification requires the state's certificate chain. This is a different trust model from self-issued VCs (Tier 2) or ZK proofs (Tier 3). It's the strongest trust signal available but introduces a dependency on government PKI.

**Selective disclosure limitations:** ISO mdoc supports selective disclosure by design. OpenID4VP in Chrome also supports it. But the granularity varies — some states may only allow all-or-nothing sharing. The implementation must gracefully degrade: request district only, but accept full address if that's what the wallet offers, then discard the address after district derivation.

---

## Implementation Considerations Across All Tiers

### OAuth to Passkey Migration

The current user base authenticates via OAuth. Migrating to passkey-primary requires:

1. **Existing users:** Prompt to add a passkey at next login. OAuth remains as fallback. The `PasskeyUpgrade.svelte` component appears after login: "Strengthen your account with a passkey (30 seconds)."
2. **New users:** Passkey is the primary registration method. OAuth is offered as "Sign in with Google/etc." alternative.
3. **Transition period:** Both auth methods coexist. `hooks.server.ts` accepts either passkey session or OAuth cookie.
4. **did:key assignment:** Only users with passkeys get a did:key. OAuth-only users remain at Tier 1 without the cryptographic backing. This is an incentive to upgrade.

### The `is_verified` Boolean Problem

The User model has `is_verified: Boolean @default(false)`. This is a Tier 3 flag — it means "has completed identity verification" (historically via self.xyz or Didit.me, now exclusively via mDL). It does NOT capture:

- Tier 1 (passkey — cryptographic identity without identity verification)
- Tier 2 (address attestation without identity verification)
- Tier 4 (government credential)

**Migration:** Keep `is_verified` for backward compatibility but derive it from `authority_level >= 3`. Add `trust_tier: Int @default(0)` as the primary graduated field. Map:

```
trust_tier = 0  →  anonymous (no user record)
trust_tier = 1  →  passkey-bound (has passkey, no address)
trust_tier = 2  →  address-attested (district verified via civic data)
trust_tier = 3  →  ZK-verified (identity verification + Shadow Atlas)
trust_tier = 4  →  government credential (mDL / EUDIW)
```

`is_verified` becomes a derived property: `is_verified = trust_tier >= 3`.

### UI Trust Signal Integration

Replace the static "Sent via email without cryptographic verification" with a dynamic component that reflects the user's current tier and offers the next upgrade.

**Component:** `TrustSignal.svelte`

```
Tier 0: "Anonymous message — Create an account to be heard"
         [Create Account] link

Tier 1: "From a verified account — Add your address for 3x response rate"
         [Verify Address] link

Tier 2: "Verified constituent of [District] — Upgrade to cryptographic verification"
         [Verify Identity] link

Tier 3: "Cryptographically verified constituent"
         Shield icon, no upgrade prompt (this is the ceiling for most users)

Tier 4: "Government-verified constituent"
         Government shield icon
```

The CWC delivery path (`variant="verified"` button) unlocks at Tier 3+. But Tier 2 also produces a meaningful signal for email delivery — include the district attestation as a verifiable link in the email body.

### Credential Store Unification

Currently, Shadow Atlas credentials are stored in IndexedDB via `shadow-atlas-handler.ts`. The new district credentials (Tier 2) also need client-side storage. And the upcoming passkey credentials need secure storage.

**Unify into a single credential store:**

```typescript
// src/lib/core/identity/credential-store.ts
interface CredentialStore {
  // Store a VC
  store(credential: VerifiableCredential): Promise<void>;

  // Retrieve by type
  get(type: 'district_residency' | 'shadow_atlas' | 'identity'): Promise<VerifiableCredential | null>;

  // Check if a credential is valid for an action
  isValidForAction(type: string, action: CredentialAction): Promise<boolean>;

  // List all credentials
  list(): Promise<VerifiableCredential[]>;

  // Clear expired
  pruneExpired(): Promise<number>;
}
```

This replaces the ad-hoc IndexedDB usage in Shadow Atlas with a general-purpose credential wallet.

### Anti-Correlation Between Tiers

If a user sends a message at Tier 2 (email with district attestation) and later sends at Tier 3 (ZK proof), can these be correlated?

**Risk:** The Tier 2 message reveals the user's email address. The Tier 3 message reveals a nullifier (unique per identity + action). If someone can link the email to the nullifier, the ZK anonymity is broken.

**Mitigation:** The nullifier is derived from `identity_commitment` (Poseidon2 hash of passport data), which is unrelated to the email address. The only correlation vector is timing — if the same template receives a Tier 2 message and a Tier 3 message from the same district within seconds, they're likely the same person.

**Recommendation:** Document this in the privacy model. For users who want maximum anonymity, recommend using Tier 3 exclusively and never sending the same message at a lower tier.

### Delivery Method Expansion

Currently `deliveryMethod` is `'email' | 'certified' | 'direct' | 'cwc'`. The graduated model requires:

```typescript
type DeliveryMethod =
  | 'mailto'           // Tier 0: raw mailto link, no verification
  | 'email_attested'   // Tier 2: email with district attestation link
  | 'cwc'              // Tier 3+: Congressional Web Contact with ZK proof
  | 'direct'           // Any tier: custom recipient list
```

The `'email'` and `'certified'` values are ambiguous — replace with explicit names. `'email_attested'` is new: the email includes a URL to a verification page where the recipient can confirm the sender's district credential.

---

## Deprecation and Removal Schedule

### Immediate (can remove now)

| Item | Location | Reason |
|------|----------|--------|
| `nitro-enclave-demo.ts` | `src/lib/core/proof/` | Demo stub, not real TEE code |
| Coinbase auth integration spec | `docs/specs/coinbase-auth-integration.md` | Superseded by passkey-first approach |

### Short-term (with Tier 2 implementation)

| Item | Location | Reason |
|------|----------|--------|
| Plaintext address fields | `users` table: `street`, `city`, `state`, `zip` | PII; derive district then clear |
| Bundled address + identity verification | `IdentityVerificationFlow.svelte` | Unbundle: address is Tier 2, identity is Tier 3 |
| Static "without cryptographic verification" text | `ActionBar.svelte` | Replace with dynamic TrustSignal |

### Medium-term (with Tier 3 completion)

| Item | Location | Reason |
|------|----------|--------|
| `gcp.ts` TEE provider | `src/lib/core/tee/providers/` | If GCP Confidential Computing not pursued, remove |
| `trust_score` derivation from OAuth provider | Multiple files | Less relevant with passkey-uniform baseline |
| Binary `is_verified` as primary flag | Schema + all consumers | Replace with `trust_tier` / `authority_level` |

### Archive (move to `docs/archive/`)

| Document | Reason |
|----------|--------|
| `docs/specs/portable-identity.md` | IPFS blob storage is Phase 3+ at best; premature optimization |
| `docs/specs/coinbase-auth-integration.md` | Superseded by passkey-first |
| `docs/archive/2025-specs-superseded/client-side-proving-architecture.md` | Already archived, confirm it stays |

### Honest status corrections needed

| Document | Issue |
|----------|-------|
| `docs/implementation-status.md` | Claims "Browser ZK Prover: INTEGRATED" — it is NOT integrated into Commons, only voter-protocol |
| `docs/specs/zk-proof-integration.md` | Claims "Wave 2.3 integration COMPLETE" — the integration files don't exist in Commons |
| `docs/architecture.md` | Reads as current architecture but describes Phase 2+ aspirations as Phase 1 |

---

## Refactoring Map

### Critical refactors (architectural)

**1. Unbundle address verification from identity verification**

Currently: `IdentityVerificationFlow.svelte` → Step 1 (value prop) → Step 2 (method: NFC or ID) → Step 3 (verify)

Needs to become:
```
VerificationFlow.svelte
  ├── Tier 1: PasskeyRegistration (if no passkey)
  ├── Tier 2: AddressVerification (standalone, no passport needed)
  │     └── AddressForm → CivicDataCheck → VCIssuance → Done
  └── Tier 3+: IdentityVerification (mDL via Digital Credentials API, builds on Tier 2)
        └── GovernmentCredentialVerification → ShadowAtlas → Done
```

The user can stop at any tier. Each tier's UI shows what they've achieved and what the next level unlocks.

**2. `emailService.analyzeEmailFlow()` → graduated routing**

Currently:
```
if (congressional && !user) → requiresAuth
if (congressional && !address) → requiresAddress
if (congressional && verified) → CWC
else → mailto
```

Needs to become:
```
if (congressional && trust_tier < 2) → prompt for minimum tier (address)
if (congressional && trust_tier == 2) → email_attested delivery
if (congressional && trust_tier >= 3) → CWC delivery
if (!congressional) → use best available delivery for trust_tier
```

**3. `authority-level.ts` → incorporate all tiers**

Currently derives from `identity_commitment` + `document_type` + `trust_score`. Needs to also check:
- `passkey_credential_id` (Tier 1)
- `district_verified` + `address_verified_at` (Tier 2)
- Keep existing Tier 3/4 logic

**4. `credential-policy.ts` → tier-aware TTL**

Currently applies TTL uniformly to all credentials. Needs to differentiate:
- Tier 2 district credential: 90-day base TTL, 30-day for constituent_message
- Tier 3 identity credential: existing TTLs apply
- Tier 4 government credential: TTL matches credential expiry from issuer

### Non-critical refactors (quality)

**5. Unify IndexedDB credential storage**

Shadow Atlas handler has its own IndexedDB logic. District credentials need storage. Passkey metadata needs storage. Build one `CredentialStore` that manages all client-side credentials.

---

## Cross-Cutting Concerns

### Privacy properties by tier

| Tier | Platform knows | Recipient knows | On-chain |
|------|---------------|-----------------|----------|
| 0 | Nothing (no account) | Email address | Nothing |
| 1 | did:key pseudonym | did:key pseudonym | Nothing |
| 2 | District (derived from address, address cleared) | District + did:key | Nothing |
| 3 | identity_commitment (Poseidon2 hash) | District membership (ZK proof, anonymous) | Nullifier only |
| 4 | Government credential metadata | District membership (from gov credential) | Same as Tier 3 |

**Key observation:** Tier 3 reveals LESS to the platform than Tier 2 (identity_commitment vs. district). This is by design — the ZK proof shifts trust from the platform to the cryptography.

### Threat model per tier

| Tier | Sybil resistance | Impersonation resistance | Surveillance resistance |
|------|------------------|--------------------------|------------------------|
| 0 | None | None | High (no identity) |
| 1 | Low (passkey per device, but unlimited devices) | Medium (passkey is unforgeable) | Medium (pseudonymous) |
| 2 | Medium (one address per credential, but addresses can be faked) | Medium (address verification is soft) | Low (district known) |
| 3 | High (identity_commitment is unique per human, enforced by document scan) | High (ZK proof is unforgeable) | High (anonymous delivery) |
| 4 | Very high (government-issued, state-backed) | Very high (government PKI) | Medium (government credential metadata) |

### Offline / degraded mode

If the Shadow Atlas API is unreachable, Tier 3 is unavailable. The system should degrade to the highest available tier:
- If civic data API is reachable: Tier 2 (address attestation)
- If nothing is reachable: Tier 1 (passkey identity only) or Tier 0 (mailto)

The `credential-store.ts` should cache credentials client-side so that previously-issued VCs can be presented even when the server is down.

### Rate limiting per tier

Higher tiers should get higher rate limits (they've proven more about themselves):

```
Tier 0: 1 message per template per day (per IP)
Tier 1: 3 messages per template per day (per did:key)
Tier 2: 10 messages per day (per district credential)
Tier 3: 1 message per representative per action (nullifier-enforced, no rate limit needed)
Tier 4: Same as Tier 3
```

---

## Delegation Guidance for Implementation Agents

Each tier is an independent workstream. They should be implemented in order (Tier 1 → 2 → 3 completion → 4) because each tier builds on the previous.

### Tier 1 agent context

**Background needed:** WebAuthn/FIDO2, passkey registration and authentication ceremonies, `did:key` specification, SimpleWebAuthn library. SvelteKit server endpoints, Convex schema (`convex/schema.ts`) updates.

**Key constraint:** Must coexist with existing OAuth auth. Do not break current login flows. Passkeys are additive.

**Test surface:** Registration ceremony, authentication ceremony, did:key derivation determinism, session management, OAuth fallback, device loss recovery.

### Tier 2 agent context

**Background needed:** W3C Verifiable Credentials 2.0 data model, US Census geocoder API, Google Civic Information API (note: Representatives API was deprecated April 2025), Ed25519 credential signing, IndexedDB storage, Svelte 5 component architecture.

**Key constraint:** Must unbundle address collection from identity verification. The `IdentityVerificationFlow.svelte` refactor is the hardest part — it has to become a multi-path component where the user can stop at address-only or continue to identity verification.

**Critical privacy requirement:** Address must be CLEARED from server after district derivation. This is non-negotiable.

**Test surface:** Address → district mapping accuracy, VC issuance and verification, TTL enforcement, address field nullification, component unbundling doesn't break existing Tier 3 flow.

### Tier 3 agent context

**Background needed:** Zero-knowledge proofs (UltraHonk/Noir circuits), Poseidon2 hash function, Merkle tree proofs, XChaCha20-Poly1305 witness encryption, AWS Nitro Enclaves, CWC API specification, Scroll zkEVM.

**Key constraint:** The voter-protocol repo contains the actual prover. The integration is a bridge between repos — the Commons browser client must load the WASM prover, construct witnesses from Shadow Atlas credentials, and submit proofs. Do not reimplement the prover.

**Test surface:** Proof generation round-trip, witness encryption/decryption, TEE attestation verification, CWC delivery, nullifier uniqueness enforcement, on-chain verification.

### Tier 4 agent context

**Background needed:** Digital Credentials API (navigator.identity.get), ISO 18013-5 (mDL), OpenID4VP, ISO mdoc, selective disclosure. Browser compatibility (Chrome and Safari only as of Feb 2026).

**Key constraint:** This tier has the smallest addressable user base (18 US states with mDLs). It must degrade gracefully — if the browser doesn't support the API, or the user doesn't have an mDL, the UI should not show this option. Feature detection first.

**Test surface:** API availability detection, credential presentation, issuer certificate verification, selective disclosure handling, graceful degradation.

---

## Implementation Progress

> Detailed cycle-by-cycle logs archived in `docs/archive/2026-03-documentation-audit/graduated-trust-implementation.md`.

| Cycle | Focus | Status | Key Outcomes |
|-------|-------|--------|--------------|
| 1 | Cleanup + Foundation | ✅ | Unified schema, added `trust_tier` field + 8 supporting fields |
| 2 | Tier 1 — Passkeys | ✅ | WebAuthn registration/authentication, `did:key` derivation, passkey UI |
| 3 | Tier 2 — Address Attestation | ✅ | AddressVerificationFlow, district-credential (W3C VC 2.0), TrustSignal UI |
| 4 | Tier 3 — Proof-Verified Delivery | ✅ | Real proof generation (WASM prover), XChaCha20-Poly1305 encryption |
| 5 | E2E CWC Delivery | ✅ | Server-side witness decryption, CWC delivery pipeline via `waitUntil()` |
| 6 | Status Tracking + Modals | ✅ | Submission status polling, retry endpoint, modal error states |
| 7 | Security + Svelte 5 | ✅ | BR5-010 nullifier fix, trust tier propagation, event dispatch migration |
| 8 | Production Hardening | ✅ | ALS safety, type safety (`as any` elimination), full Svelte 5 migration |
| 9 | Tier 4 — Gov Credentials | ✅ | mDL via Digital Credentials API, COSE_Sign1, IACA trust store, OpenID4VP |
| 10 | Production Readiness | ✅ | CF Workers build, final Svelte 5 migration, ~1,300 lines dead code removed |
| 11 | Type Safety | ✅ | svelte-check 0 errors, libsodium eliminated from server |
| 12 | Dead Code Purge | ✅ | ~8,700 lines removed, broken event wiring fixed |
| 13 | Crypto Verification | ✅ | COSE_Sign1 ECDSA, Ed25519 credential signing, 47 new tests |
| 14 | Security Tests | ✅ | 36 new security tests, debug logs removed, input limits tightened |
| 15–19 | Final Hardening | 📋 Planned | Type safety purge, Workers infra, stub elimination |

---

## Document Cross-References

| Existing document | Relationship to this document |
|------------------|-------------------------------|
| `docs/authority-levels.md` | Mapped to tiers; extend with Tier 0 and Tier 4 |
| `docs/shadow-atlas-integration.md` | Shadow Atlas integration (Tier 3 proofs + officials resolution) |
| `docs/specs/zk-proof-integration.md` | Tier 3 prover integration reference (note: status claims are overstated) |
| `docs/design/patterns/identity-verification.md` | UX framing; update to reflect graduated model |
| `docs/adr/007-identity-schema-migration.md` | Historical context for current schema design |
| `docs/congressional/delivery.md` | CWC delivery specification; Tier 3 delivery reference |
| `docs/specs/proof-generation-ux.md` | Tier 3 UX reference |
| `docs/architecture/tee-systems.md` | Tier 3 TEE infrastructure reference |
| `docs/specs/universal-credibility.md` | Orthogonal to trust tiers (expertise, not identity) |
| `docs/cryptography.md` | Cryptographic primitives reference |
| `src/lib/core/identity/credential-policy.ts` | TTL enforcement — extend for tier-aware policies |
| `src/lib/core/identity/authority-level.ts` | Authority derivation — extend for all tiers |

---

*Commons PBC | Graduated Trust Architecture | 2026-02-16*
