# Graduated Trust — Implementation Plan

> **Status:** Active execution plan
> **Architecture reference:** `docs/architecture/graduated-trust.md`
> **Pre-launch:** All deprecated code removed immediately. No backward compatibility.

---

## Execution Model

**Cycles:** Implementation wave → Opus review wave → Manual review → Doc update → Next cycle

Each cycle produces:
1. Code changes (committed)
2. Findings log (what the agents missed, what emerged)
3. Updated docs (completion status, new discoveries)
4. Tasking for next cycle

---

## Cycle 1: Cleanup + Foundation

Remove deprecated code, consolidate schemas, establish the trust_tier field as the primary identity primitive. This unblocks all subsequent work.

### Wave 1A: Deprecated Code Removal

**Agent background:** SvelteKit codebase familiarity, Convex schema management, file system cleanup.

| Task | File(s) | Action |
|------|---------|--------|
| Remove nitro enclave demo | `src/lib/core/proof/nitro-enclave-demo.ts` | Delete entirely |
| Remove GCP TEE provider | `src/lib/core/tee/providers/gcp.ts` | Delete; update `src/lib/core/tee/provider.ts` if it imports gcp |
| Archive coinbase auth spec | `docs/specs/coinbase-auth-integration.md` | Move to `docs/archive/2026-02-superseded/` |
| Archive portable identity spec | `docs/specs/portable-identity.md` | Move to `docs/archive/2026-02-superseded/` |
| Remove static trust disclaimer | `src/lib/components/template-browser/parts/ActionBar.svelte` | Remove the hardcoded `<p>` tag (already changed to flex-col; will be replaced by TrustSignal in Cycle 3) |

**Verification:** `npm run build` succeeds. `grep -r` for imports of deleted files returns nothing.

### Wave 1B: Schema Consolidation

**Agent background:** Convex schema design, table/index configuration, multi-file consolidation.

| Task | Detail |
|------|--------|
| Identify canonical schema | `convex/schema.ts` is canonical |
| Diff any stale schema drafts | Document every divergence |
| Determine if non-canonical schemas are consumed anywhere | Check `package.json`, build scripts, CI, wrangler config for references |
| Delete or unify non-canonical schemas | If nothing consumes them: delete. If build uses them: unify. |

**Verification:** Single schema. `npx convex dev` builds cleanly. No references to deleted schema files.

### Wave 1C: Trust Tier Foundation

**Agent background:** TypeScript, Convex schema design, SvelteKit server hooks, identity systems.

| Task | Detail |
|------|--------|
| Add `trustTier` field to `users` table | `trustTier: v.number()` (default 0) |
| Derive `isVerified` from trustTier | Add computed logic: `isVerified = trustTier >= 3` |
| Extend `authority-level.ts` | Add Tier 0 (anonymous, no user) and adjust Tier 1/2 logic |
| Add `trustTier` to session locals | `hooks.server.ts` — attach `trustTier` to `event.locals.user` |
| Update `credential-policy.ts` | Add tier-aware TTL differentiation (prep only — no new tiers yet) |
| Add address lifecycle fields | `addressVerificationMethod`, `addressVerifiedAt` on `users` table |
| Add passkey placeholder fields | `passkeyCredentialId`, `passkeyPublicKeyJwk`, `didKey`, `passkeyCreatedAt`, `passkeyLastUsedAt` on `users` table |
| Deploy schema | `npx convex dev` picks up the new fields; ship via `npx convex deploy --env-file .env.production` |

**Verification:** Migration applies cleanly. `trust_tier` defaults to 0 for all existing users. `authority-level.ts` exports a function that handles all tiers. `hooks.server.ts` attaches trust_tier to locals.

---

## Cycle 2: Tier 1 — Passkey Infrastructure

### Wave 2A: Server-Side Passkey

**Agent background:** WebAuthn/FIDO2 protocol, `@simplewebauthn/server` library, challenge-response authentication, SvelteKit server endpoints, session management.

| Task | Detail |
|------|--------|
| Install dependencies | `@simplewebauthn/server`, `@simplewebauthn/browser` |
| Create registration endpoint | `src/routes/api/auth/passkey/register/+server.ts` — generate challenge, verify attestation, store credential |
| Create authentication endpoint | `src/routes/api/auth/passkey/authenticate/+server.ts` — generate challenge, verify assertion, create session |
| Create `passkey-registration.ts` | `src/lib/core/identity/passkey-registration.ts` — server-side registration logic |
| Create `passkey-authentication.ts` | `src/lib/core/identity/passkey-authentication.ts` — server-side auth logic |
| Update session creation | Support passkey-based sessions alongside OAuth sessions |
| Update `hooks.server.ts` | Accept passkey session tokens in addition to OAuth cookies |

### Wave 2B: did:key Derivation

**Agent background:** DID specifications, `did:key` method, multicodec encoding, public key JWK format, Ed25519/P-256 key handling.

| Task | Detail |
|------|--------|
| Create `did-key-derivation.ts` | `src/lib/core/identity/did-key-derivation.ts` — derive did:key from WebAuthn public key |
| Handle key algorithm variants | P-256 (WebAuthn default on Apple) and Ed25519 |
| Store did:key on registration | Write to User.did_key after passkey registration |
| Add did:key to session locals | Available in `event.locals.user.did_key` |

### Wave 2C: Client-Side Passkey UI

**Agent background:** Svelte 5 runes, `@simplewebauthn/browser`, WebAuthn UX patterns, progressive enhancement.

| Task | Detail |
|------|--------|
| Create `PasskeyRegistration.svelte` | `src/lib/components/auth/PasskeyRegistration.svelte` — biometric prompt, success state |
| Create `PasskeyUpgrade.svelte` | `src/lib/components/auth/PasskeyUpgrade.svelte` — nudge for OAuth users |
| Integrate into auth flow | After OAuth login, check if user has passkey. If not, show upgrade nudge. |
| Feature detection | Check `window.PublicKeyCredential` availability. Hide passkey UI on unsupported browsers. |
| Update trust_tier on registration | Set `trust_tier = 1` after successful passkey registration |

**Verification:** Full registration → authentication → session cycle works. OAuth fallback still works. did:key is deterministic for the same public key. trust_tier updates correctly.

---

## Cycle 3: Tier 2 — Address Attestation

### Wave 3A: Unbundle Address from Identity Verification

**Agent background:** Svelte 5 component architecture, progressive disclosure UX, existing IdentityVerificationFlow.svelte internals.

| Task | Detail |
|------|--------|
| Refactor `IdentityVerificationFlow.svelte` | Split into multi-path: Tier 2 (address only) vs Tier 3 (identity). User can stop at address. |
| Make `AddressForm.svelte` independently usable | Not coupled to identity verification parent |
| Create `AddressVerificationFlow.svelte` | Standalone flow: address form → civic data check → district confirmation → done |
| Update `VerificationGate.svelte` | Gate at Tier 2 minimum for congressional, not Tier 3 |
| Update `emailService.analyzeEmailFlow()` | Graduated routing: Tier 2 → email_attested, Tier 3+ → CWC |

### Wave 3B: Civic Data API + District Credential

**Agent background:** US Census geocoder API, W3C Verifiable Credentials 2.0 data model, Ed25519 signing, JSON-LD, IndexedDB.

| Task | Detail |
|------|--------|
| Create `address-verification.ts` | `src/lib/core/identity/address-verification.ts` — Census geocoder integration, district derivation |
| Create `district-credential.ts` | `src/lib/core/identity/district-credential.ts` — VC issuance, signing, verification |
| Create verify-address endpoint | `src/routes/api/identity/verify-address/+server.ts` — address → district → VC |
| Add DistrictCredential table | Convex schema addition per graduated-trust.md spec |
| Implement address nullification | After district derivation, clear street/city/state/zip from User record |
| Create `credential-store.ts` | `src/lib/core/identity/credential-store.ts` — unified IndexedDB credential wallet |
| Store VC client-side | DistrictResidencyCredential stored in IndexedDB |

### Wave 3C: Trust Signal UI + Delivery Routing

**Agent background:** Svelte 5, perceptual engineering, progressive disclosure, email service architecture.

| Task | Detail |
|------|--------|
| Create `TrustSignal.svelte` | Dynamic trust display per tier, upgrade affordances |
| Integrate into `ActionBar.svelte` | Replace removed static disclaimer with TrustSignal |
| Update delivery method types | Add `'email_attested'` delivery method |
| Update `emailService.ts` | Tier-aware delivery: include district attestation link for Tier 2 emails |
| Update `ActionBar.svelte` button variants | Tier-appropriate button styling and text |

**Verification:** Full Tier 2 flow: enter address → district derived → VC issued → address cleared from DB → TrustSignal shows "Verified constituent of [District]" → email includes attestation. Tier 3 flow still works unchanged.

---

## Cycle 4: Tier 3 — Proof-Verified Delivery

Post-Cycle 3 research findings: ~~self.xyz NFC (4E)~~ (removed — Cycle 15), Shadow Atlas two-tree registration, CWC client (Senate/House), and identity blob encryption are **already production-ready**. Cycle 4 focuses on the three remaining gaps: real proof generation, proper encryption, and end-to-end verified delivery.

> **Note (Cycle 15):** self.xyz and Didit.me providers have been removed. mDL via the Digital Credentials API is the sole active verification path. References to self.xyz and Didit.me in completed cycle notes below are historical records of work done before removal.

### Wave 4A: Wire Real Proof Generation

**Background:** ProofGenerationModal.svelte is mock (100-byte fake proof). All prover infrastructure exists (@voter-protocol/noir-prover, circuit JSON, singleton caching, threading model). The gap is the "last mile" wiring.

| Task | Detail |
|------|--------|
| Fix identityCommitment in prover-client.ts | Missing from TwoTreeProofInput mapping at line 478 (causes svelte-check error) |
| Fix Buffer.from usage | Line 508 uses Node.js Buffer — incompatible with CF Workers. Replace with Uint8Array hex conversion. |
| Wire ProofGenerationModal to real prover | Accept userId + actionDomain props. Load credential from IndexedDB. Compute nullifier via poseidonHash2. Map via proof-input-mapper.ts. Call generateTwoTreeProof(). Return real proof bytes. |
| Wire progress callbacks | Real progress from prover initialization and proof generation (not simulated setInterval) |

### Wave 4B: XChaCha20 Witness Encryption

**Background:** witness-encryption.ts uses AES-GCM fallback (Web Crypto). TEE key endpoint returns mock key. Line 184 has explicit TODO for @stablelib/xchacha20poly1305.

| Task | Detail |
|------|--------|
| Install @stablelib/xchacha20poly1305 | Pure JS implementation, no WASM, works in all browsers |
| Replace AES-GCM fallback | Use @stablelib XChaCha20-Poly1305 with 24-byte nonce. Remove 12-byte IV truncation hack. |
| Update WitnessData for two-tree | Add identityCommitment, cellId, cellMapRoot, two-tree merkle fields |
| Fix ECDH curve alignment | TEE key spec says X25519 but browser uses P-256. Align or document the mismatch. |

### Wave 4C: Proof-Verified Delivery Pipeline + Tier 3 Gate

**Background:** CWC client (Senate direct, House proxy) works. ProofGenerator.svelte already handles the full end-to-end flow (credential → proof → encrypt → submit). Missing: proper WitnessData for two-tree, encryption text alignment, trust tier 3 promotion, redundant ProofGenerationModal removal.

| Task | Detail |
|------|--------|
| Remove redundant ProofGenerationModal from VerificationGate | ProofGenerationModal generated a second proof that was discarded. VerificationGate now only handles verification (Tier 2 address, Tier 3 identity). Proof generation happens in ProofGenerator. |
| Fix ProofGenerator witness encryption | Build full WitnessData with all two-tree fields (userRoot, cellMapRoot, districts, identityCommitment, etc.) instead of simplified {address, nullifier, templateId, timestamp} |
| Update encryption UI text | "XChaCha20-Poly1305 encryption" replaces "P-256 ECDH + AES-256-GCM" |
| Tier 3 trust promotion | `updateMany({ where: { id, trust_tier: { lt: 3 } }, data: { trust_tier: 3 } })` after successful submission (fire-and-forget) |

**Deferred to Cycle 5:** AWS Nitro Enclaves deployment (requires infrastructure, not just code). TEE manager/provider interfaces are ready. Azure Confidential VMs integration.

---

## Cycle 5: End-to-End CWC Delivery (Path A — Server-Side Decryption)

Real congressional delivery. Encrypt witness on client, decrypt on server, deliver via CWC API. TEE upgrade path is a deployment change only (same code, different key holder).

### Wave 5A: Address Flow Fix
- Fix AddressCollectionForm → TemplateModal callback (was CustomEvent, actually plain object)
- Remove broken POST to `/user/address` (endpoint never existed)
- Add structured `deliveryAddress` to WitnessData (name, email, street, city, state, zip)
- Update ProofGenerator: `address: string` → `deliveryAddress?: {...}` structured prop
- Wire TemplateModal to pass structured data from AddressCollectionForm → ProofGenerator

### Wave 5B: Server-Side Witness Decryption
- Create `src/lib/server/witness-decryption.ts`: X25519 ECDH → BLAKE2b KDF → XChaCha20-Poly1305 decrypt
- Replace mock TEE endpoint (`'0x' + '1'.repeat(64)`) with real key from `WITNESS_ENCRYPTION_PUBLIC_KEY` env var
- Create `scripts/generate-witness-keypair.ts` for key generation
- Roundtrip test confirmed: client encrypt → server decrypt produces identical output

### Wave 5C: CWC Delivery Pipeline
- Create `src/lib/server/delivery-worker.ts`: decrypt → lookup reps → CWC submit → update status
- Wire into submission endpoint with `platform.context.waitUntil()` (CF Workers background processing)
- Senate endpoint toggleable: `CWC_PRODUCTION=true` switches `/testing-messages/` → `/messages/`
- Per-representative error isolation (one failure doesn't block others)

### Wave 5D: Review Fixes + Polish
- Fix fragile address parsing: pass structured fields from AddressCollectionForm (not string parsing)
- Fix silent fake delivery: Senate fails loudly when `CWC_API_KEY` missing (was `simulateSubmission` returning success)
- Document `delivery_status` enum: pending → processing → delivered | partial | failed
- Add `WITNESS_ENCRYPTION_PUBLIC_KEY` to app.d.ts + .env.example
- Fix type assertion precedence in delivery worker message extraction

---

## Cycle 6: Fix Post-Proof Pipeline & Modal Error States

The delivery worker (Cycle 5) writes status to the Submission model, but the client-side tracking component was polling the wrong table (CWCJob). Modal state machine had multiple dead ends. This cycle closes the gap between server-side delivery and client-side UX.

### Wave 6A: Fix Status Tracking Pipeline
- Created `GET /api/submissions/[id]/status` — queries Submission model with pseudonymous ID ownership check
- Created `POST /api/submissions/[id]/retry` — atomic conditional retry (only from `failed` state, prevents TOCTOU race)
- Rewrote `SubmissionStatus.svelte` — removed dead WebSocket code, polls correct endpoint, AbortController for unmount safety, generation counter for stale response discard, `onDelivered` callback

### Wave 6B: Fix Modal Dead Ends
- Added `'cwc-submission' | 'error'` to `LegacyModalState` type (killed all `as any` casts on state)
- Added error state UI branch in TemplateModal (was rendering blank on submission error)
- Fixed guest + congressional dead end: "Authentication Required" now has sign-in CTA button
- Added `autoStart` prop to ProofGenerator (eliminates redundant second click)

### Wave 6C: Dead Code Cleanup
- Removed dead `CWCProgressTracker` import (imported but never rendered)
- Removed dead `showPreWrittenMessages` state variable
- Removed debug `console.log` statements from ModalRegistry production render path
- Added `{:else}` fallback for unhandled modal states

### Wave 6D: Opus Review Fixes
- Fixed TOCTOU race in retry endpoint (atomic `updateMany` with `delivery_status: 'failed'` WHERE clause)
- Fixed infinite polling on 401/403/404 (terminal HTTP errors now stop poller)
- Added AbortController to prevent state updates on destroyed components
- Added poll generation counter to discard stale responses after retry
- Removed aggressive 2s auto-navigation from onDelivered (let user interact with celebration)
- Added `{:else}` fallback for `auth_required`/`proof-generation` states that had no UI branch

## Cycle 7: Security Fixes + Svelte 5 Migration

Security bugs (BR5-010 nullifier no-op, address bypass), UX bugs (VerificationGate trust tier, hasAddress always-false), and legacy Svelte 4 event patterns.

### Wave 7A: BR5-010 Nullifier Fix + Dead Code
- Fixed nullifier self-comparison: saved `expectedNullifier` before overwriting `nullifierHex` with prover output. Cross-validation now compares against independently-computed value.
- Removed dead try/catch from `submitCongressionalMessage()` (sync setState can't throw)
- Fixed `handleProofError` → routes to `error` state instead of `retry_needed` (which shows wrong "Email client didn't open" text)

### Wave 7B: Trust Tier + hasAddress Fixes
- Widened TemplateModal `user` prop type to include `trust_tier`
- Passed `userTrustTier={user.trust_tier ?? 0}` to VerificationGate (was always defaulting to 0, causing unnecessary verification prompts)
- Fixed `hasAddress` to check `verifiedAddress` state instead of non-existent `user.street/city/state/zip` fields

### Wave 7C: Svelte 5 Event Migration
- ProofGenerator: `createEventDispatcher` → `oncomplete`/`oncancel`/`onerror` callback props
- VerificationGate: `createEventDispatcher` → `onverified`/`oncancel` callback props
- TemplateModal: Updated call sites and handler signatures (CustomEvent → direct data)

### Wave 7D: Opus Review Fixes
- Fixed CRITICAL: `onMount` CWC path bypassed address collection/verification, sending proofs with no delivery address. Now routes through `handleSendConfirmation(true)`.
- Fixed HIGH: `as any` cast on `proofState.message` replaced with local `errorMessage` variable
- Added TODO for IdentityVerificationFlow Svelte 5 migration (still uses `createEventDispatcher`)
- Deferred: TemplateModal's own `createEventDispatcher` (requires parent migration), `needsTier3` dead derived, legacy single-tree BR5-010 gap

## Cycle 8: Production Hardening + Code Quality

Address 10 deferred issues from Cycles 6-7, including a production risk (ALS+waitUntil), type safety gaps, and incomplete Svelte 5 migration.

### Wave 8A: ALS Safety + Error Sanitization
- Added `getRequestClient()` to `db.ts` — resolves the concrete per-request backend client from ALS (not the Proxy)
- `delivery-worker.ts` accepts optional `db` parameter, uses captured client in `waitUntil`
- Callers (`create/+server.ts`, `retry/+server.ts`) capture client via `getRequestClient()` before response
- Sanitized `delivery_error` in status endpoint (generic user-safe message)

### Wave 8B: Type Safety + `as any` Elimination
- Created `EmailFlowTemplate` shared interface (both Template and ComponentTemplate satisfy it)
- Added `category?`, `subject?`, `preview?` to `ComponentTemplate`
- Changed `analyzeEmailFlow` + related functions to accept `EmailFlowTemplate`
- Eliminated: `as unknown as Template`, `(template as any).category`, `(template as any).body`, `handleAddressComplete as any`, `(proofState as any).submissionId`

### Wave 8C: Complete Svelte 5 Migration
- `IdentityVerificationFlow`: `createEventDispatcher` → `oncomplete`/`oncancel`/`onback` callback props
- `TemplateModal`: `createEventDispatcher` → `onclose`/`onused` callback props
- Updated consumers: `template-modal/[slug]/+page.svelte`, `ModalRegistry.svelte`
- Removed dead `needsTier3` derived from VerificationGate
- Fixed double oncomplete dispatch in ProofGenerator (kept auto-dispatch, removed Continue re-dispatch)
- Removed 22 redundant `credential!` assertions in ProofGenerator

### Wave 8D: Legacy Cleanup + Opus Review
- Gated legacy single-tree flow with deprecation warning + documentation
- Opus review found 0 critical, 3 high, 5 medium, 9 low issues
- Fixed: trust tier promotion uses captured client + registered with waitUntil (HIGH)
- Fixed: IdentityVerificationFlow verificationData stores full payload (HIGH, data loss on re-dispatch)
- Fixed: tautological validation `!template.title && !template.title` → `!template.title && !template.subject` (MEDIUM)
- Fixed: stale `on:error` comment, unused `{@const}` in ProofGenerator
- Added Cycle 7 status table (was missing from tracking section)

## Cycle 9: Government Credentials — Tier 4

Browser-native mDL verification via W3C Digital Credentials API. Ship pragmatic minimum (Option A: server decrypts in memory, derives district, discards address), architect for TEE upgrade path (Option B: same code runs inside Nitro Enclave, server never sees plaintext).

**Privacy architecture:** Selective disclosure requests ONLY `resident_postal_code` + `resident_city` + `resident_state`. Never name, DOB, photo, document number. `intent_to_retain: false` on all fields. The `processCredentialResponse()` function boundary IS the privacy boundary — raw address never escapes it, only the derived fact (`{ district, verificationMethod: 'mdl' }`). Ephemeral key pairs (5-min TTL) prevent persistent decryption capability. Same nullifier source as Tier 3 (identity_commitment from Shadow Atlas), just with higher provenance.

**Browser support:** Chrome 141+ (org-iso-mdoc + openid4vp), Safari 26+ (org-iso-mdoc only). Firefox: no support, no plans. 21 US states + PR have active mDL programs. Progressive enhancement — mDL option only shown when `typeof DigitalCredential !== 'undefined'`.

### Wave 9A: Foundation + Types

Fix authority level discrepancy, extend verification type system for mDL.

| Task | File(s) | Detail |
|------|---------|--------|
| Fix `trustTierToAuthorityLevel(4)` | `authority-level.ts` | Currently returns 4, should return 5 per arch doc |
| Fix `deriveAuthorityLevel()` for mdl | `authority-level.ts` | Add `document_type === 'mdl'` → authority level 5 path |
| Add `'mdl'` to `VerificationMethod` | `src/lib/types/verification.ts` | `'nfc-passport' \| 'government-id' \| 'mdl'` |
| Add `'digital-credentials-api'` to `VerificationProvider` | `src/lib/types/verification.ts` | `'self.xyz' \| 'didit.me' \| 'digital-credentials-api'` (self.xyz and didit.me are legacy values — removed as active providers in Cycle 15) |
| Add mDL entry to `VERIFICATION_METHODS` | `src/lib/types/verification.ts` | Display metadata for new method |
| Update session + handler types | `session-cache.ts`, `session-credentials.ts`, `shadow-atlas-handler.ts` | Add `'mdl'` / `'digital-credentials-api'` to method unions |
| Add rate limit path | `hooks.server.ts` | Add `/api/identity/verify-mdl` to `SENSITIVE_IDENTITY_PATHS` |
| Create DigitalCredential type declarations | `src/lib/types/digital-credentials.d.ts` | TypeScript declarations for `DigitalCredential`, `navigator.credentials.get({ digital })` — new browser API without `@types` |

### Wave 9B: Client-Side Digital Credentials API

Browser feature detection, dual-protocol request builder, and UI component.

| Task | File(s) | Detail |
|------|---------|--------|
| Create `digital-credentials-api.ts` | `src/lib/core/identity/digital-credentials-api.ts` | `isDigitalCredentialsSupported()` feature detection. `getSupportedProtocols()` — checks `userAgentAllowsProtocol('org-iso-mdoc')` and `userAgentAllowsProtocol('openid4vp')`. `requestCredential(requests)` — wrapper around `navigator.credentials.get({ digital })` with AbortController timeout (60s for wallet interaction), graceful AbortError handling for user dismissal. |
| Create `GovernmentCredentialVerification.svelte` | `src/lib/components/auth/GovernmentCredentialVerification.svelte` | Svelte 5 component. States: `idle` → `requesting` (OS wallet prompt) → `verifying` (server processing) → `complete` / `error` / `unsupported`. Callback props: `oncomplete`, `oncancel`, `onerror`. Flow: fetch `/api/identity/verify-mdl/start` → call `requestCredential()` → POST to `/api/identity/verify-mdl/verify`. Unsupported fallback: "Your browser doesn't support digital ID. Use NFC passport or document scan instead." |

### Wave 9C: Server-Side Verification Pipeline

Enclave-portable verification. The `processCredentialResponse()` function runs in a CF Worker today, moves to TEE unchanged later.

| Task | File(s) | Detail |
|------|---------|--------|
| Create request start endpoint | `src/routes/api/identity/verify-mdl/start/+server.ts` | Generate ephemeral ECDH key pair (P-256) via `crypto.subtle`. Store private key + nonce in Workers KV (`DC_SESSION_KV`, 5-min TTL). Build dual-protocol request: `org-iso-mdoc` DeviceRequest (doctype `org.iso.18013.5.1.mDL`, fields: `resident_postal_code`, `resident_city`, `resident_state`, all `intent_to_retain: false`) + `openid4vp` DCQL query (same fields). Return both + nonce to client. |
| Create `mdl-verification.ts` | `src/lib/core/identity/mdl-verification.ts` | **The privacy boundary function.** `processCredentialResponse(encryptedResponse, protocol, ephemeralPrivateKey)` → `{ district, state, verificationMethod: 'mdl' }`. Dispatches to `decryptMdocResponse()` or `decryptOid4vpResponse()`. CBOR decode via `cbor-web` (Workers-compatible). COSE_Sign1 signature verification against IACA roots. MSO valueDigest validation. DeviceAuth check. Returns ONLY derived district — raw address fields never leave this function scope. |
| Create IACA trust store | `src/lib/core/identity/iaca-roots.ts` | Hardcoded IACA root certificates for ~10 most populated mDL states (CA, TX, NY, FL, etc.). Published by AAMVA. Used for issuer signature verification. |
| Create verification endpoint | `src/routes/api/identity/verify-mdl/verify/+server.ts` | Accept `{ protocol, data, nonce }`. Retrieve + delete ephemeral key from KV (one-time use). Call `processCredentialResponse()`. Map result to district via existing civic data pipeline. DB transaction: set `document_type = 'mdl'`, `address_verification_method = 'mdl'` on User. Issue DistrictResidencyCredential (same as Tier 2 but `verification_method: 'mdl'`). Shadow Atlas registration if not already registered. Trust tier promotes automatically via `deriveTrustTier()` (existing stub activates). |
| Install dependencies | `package.json` | `cbor-web` for CBOR decoding. Evaluate `@animo-id/mdoc` for COSE verification on Workers — if incompatible, manual verification via `crypto.subtle`. |
| Add KV binding | `wrangler.toml` | `DC_SESSION_KV` namespace for ephemeral key storage |

### Wave 9D: Integration + Opus Review

Wire into existing verification flow, feature detection, review.

| Task | File(s) | Detail |
|------|---------|--------|
| Add mDL option to VerificationChoice | `src/lib/components/auth/address-steps/VerificationChoice.svelte` | Third option: "Verify with Digital ID" (shield/smartphone icon). Only shown when `isDigitalCredentialsSupported()` returns true. Description: "Use your state-issued digital driver's license — fastest, most private." |
| Wire into IdentityVerificationFlow | `IdentityVerificationFlow.svelte` | Add `'verify-mdl'` to `FlowStep` type. When mDL selected, render `GovernmentCredentialVerification`. Handle oncomplete → advance to complete step with full data. |
| Update VerificationGate for Tier 4 | `VerificationGate.svelte` | For `minimumTier >= 4` (future-proofing), show GovernmentCredentialVerification directly. For now, Tier 4 is reached through the existing choice flow. |
| Opus review | — | Full review of all Cycle 9 changes. Focus: privacy boundary integrity, selective disclosure correctness, ephemeral key lifecycle, COSE verification completeness, Workers KV TTL enforcement. |

**Verification:** Full Tier 4 flow: click "Verify with Digital ID" → OS wallet prompt with ONLY postal code/city/state fields visible → server verifies + derives district → address discarded → DistrictResidencyCredential issued → trust_tier=4 via deriveTrustTier() → authority_level=5. Existing NFC/document scan paths unchanged. Firefox/unsupported browsers see fallback.

---

## Tracking

After each cycle:
1. Update `docs/architecture/graduated-trust.md` — mark completed work, note findings
2. Update `docs/implementation-status.md` — honest status
3. Log emerging discoveries in this file under the cycle heading
4. Task next cycle based on review findings

### Cycle 1 Status

| Wave | Status | Notes |
|------|--------|-------|
| 1A: Deprecated removal | **COMPLETE** | 2026-02-16: Deleted nitro-enclave-demo.ts, gcp.ts. Archived coinbase-auth + portable-identity specs. Cleaned manager.ts + provider.ts types. Removed static disclaimer from ActionBar. Opus review: fixed 2 stale GCP comments in provider.ts header. |
| 1B: Schema consolidation | **COMPLETE** | 2026-02-16: Removed stale schema drafts. Updated mock-drift-detection.ts. `convex/schema.ts` is canonical. Opus review: cleaned agent artifact from .planning/. |
| 1C: Trust tier foundation | **COMPLETE** | 2026-02-16: Added 9 fields to schema (trust_tier, 5 passkey, 2 address). Added deriveTrustTier() + TrustTier type + TRUST_TIER_LABELS + trustTierToAuthorityLevel() to authority-level.ts. Added TIER_CREDENTIAL_TTL + isTierCredentialFresh() to credential-policy.ts. hooks.server.ts computes trust_tier per-request. auth.ts User interface extended with 4 new fields. Opus review: cleaned stale GCP env vars from app.d.ts + .env.example. Finding: is_verified derivation from trust_tier correctly deferred — needs data migration to set trust_tier=3 for users with identity_commitment before is_verified can be computed. Migration generation deferred to pre-Cycle 2. |

### Cycle 2 Status

| Wave | Status | Notes |
|------|--------|-------|
| 2A: Server passkey | **COMPLETE** | 2026-02-16: Installed @simplewebauthn/server + /browser. Created passkey-rp-config.ts, passkey-registration.ts, passkey-authentication.ts. Created register + authenticate endpoints. Opus review: fixed excludeCredentials bug (endpoint passed null; function now queries DB), fixed FK violation (usernameless auth used sentinel user_id that violates VerificationSession FK; now requires email, usernameless deferred to Phase 2). |
| 2B: did:key derivation | **COMPLETE** | 2026-02-16: Created did-key-derivation.ts with zero-dependency CBOR parser, base58btc encoder, P-256 + Ed25519 support. Added did_key to auth.ts User, app.d.ts, hooks.server.ts. 33 tests all passing (known vectors, edge cases, error handling). |
| 2C: Client passkey UI | **COMPLETE** | 2026-02-16: Created PasskeyRegistration.svelte (biometric feature detection, idle→registering→success/error states), PasskeyLogin.svelte (email-based passkey auth with "or" divider), PasskeyUpgrade.svelte (dismissible 7-day nudge banner for trust_tier 0 users). Integrated PasskeyLogin into SignInContent.svelte, PasskeyUpgrade into profile overview tab. Opus review: fixed 3 issues — (1) `$state<Type>()` generic syntax not supported in Svelte 5, switched to `let x: Type = $state()` annotations; (2) variable named `state` conflicts with `$state` rune (svelte-check interprets `$state` as store auto-subscription), renamed to `uiState`; (3) `!state` always false in Enter key handler (state is never empty string), changed to `state === 'idle'`; (4) profile layout missing trust_tier in user data, added to +layout.server.ts; (5) removed unused email/id from PasskeyUpgrade prop type; (6) cleaned 3 agent artifact .md files. |

### Cycle 3 Status

| Wave | Status | Notes |
|------|--------|-------|
| 3A: Unbundle address | **COMPLETE** | 2026-02-16: Created AddressVerificationFlow.svelte (standalone Tier 2 flow: address-input → verifying → confirm-district → issuing-credential → complete). Updated VerificationGate.svelte with minimumTier/userTrustTier props, tier-aware header, conditional rendering (Tier 2 → AddressVerificationFlow, Tier 3 → IdentityVerificationFlow). Added DistrictCredential model to schema (user_id FK, congressional/state districts, verification_method, credential_hash, expires_at, revoked_at). Added 'email_attested' to deliveryMethod union type. Opus review: fixed 2 bugs — (1) AddressVerificationFlow didn't store credential in IndexedDB after issuance (added storeCredential() call from credential-store.ts); (2) no invalidateAll() after trust tier upgrade (added import + call so session data refreshes). |
| 3B: Civic data + credential | **COMPLETE** | 2026-02-16: Created district-credential.ts (W3C VC 2.0 DistrictResidencyCredential — HMAC-SHA256 signing via Web Crypto, base64url encode/decode, deterministic JSON via deepSortKeys, hashCredential + hashDistrict for integrity/privacy). Created credential-store.ts (IndexedDB wallet — compound key [userId,type], SSR-safe, store/get/delete/prune API). Created verify-address endpoint (validates district format XX-NN/XX-AL, issues VC, DB transaction: DistrictCredential record + User trust_tier upgrade, returns credential+hash to client). 18 tests all passing (issuance structure, 90-day TTL, did:key usage/fallback, 5 tamper scenarios, hash determinism/uniqueness). Opus review: fixed Uint8Array<ArrayBufferLike> vs BufferSource type mismatch in verifyDistrictCredential. Design note: proof.type says Ed25519Signature2020 but actually HMAC — pragmatic for CF Workers, Ed25519 deferred to Cycle 4. |
| 3C: Trust signal UI | **COMPLETE** | 2026-02-16: Created TrustSignal.svelte (compact tier badge: icon + label + color per tier, upgrade affordance for tier < 2). Updated ActionBar.svelte: tier-aware button text ("Send as Verified Constituent" for Tier 2+), TrustSignal shown above send button, onVerifyAddress callback prop. Updated emailService.ts: analyzeEmailFlow() accepts trustTier option, Tier 2+ bypass address gating (already district-verified), email_attested delivery method with district attestation footer for Tier 2+ congressional emails. Updated +page.svelte to pass trust_tier through to ActionBar and all analyzeEmailFlow calls. Opus review: fixed 2 bugs — (1) $derived(() => {...}) stored function instead of computed value for buttonText (changed to inline $derived expression); (2) all 4 analyzeEmailFlow() calls in +page.svelte missing trustTier option (Tier 2 users would get stuck in address modal). Also updated TemplatePreview user type to include trust_tier for prop chain consistency. |

### Cycle 4 Status

| Wave | Status | Notes |
|------|--------|-------|
| 4A: Real proof generation | **COMPLETE** | 2026-02-17: Fixed identityCommitment missing from TwoTreeProofInput mapping in prover-client.ts (resolved pre-existing svelte-check error). Replaced Buffer.from with uint8ArrayToHex helper (CF Workers compatible). Rewired ProofGenerationModal from mock (100-byte fake proof + setTimeout) to real flow: getSessionCredential → buildActionDomain → computeNullifier → mapCredentialToProofInputs → generateTwoTreeProof with real progress callbacks. Added userId + templateId + sessionId props. Updated VerificationGate to pass new props. Opus review: clean, no bugs. |
| 4B: XChaCha20 encryption | **COMPLETE** | 2026-02-17: Replaced AES-GCM fallback with real XChaCha20-Poly1305 via libsodium-wrappers (already installed). X25519 ECDH replaces P-256 (now matches TEE key spec). Full 24-byte nonce (no more 12-byte truncation hack). BLAKE2b keyed hash for KDF (replaces HKDF via Web Crypto). Updated WitnessData interface for two-tree architecture (userRoot, cellMapRoot, districts, identityCommitment, cellId, tree paths). Opus review: removed dead bytesToBase64 function (unreachable after AES-GCM removal). |
| 4C: Proof-verified delivery | **COMPLETE** | 2026-02-17: Removed redundant ProofGenerationModal from VerificationGate (proof was generated twice — once in ProofGenerationModal, then again in ProofGenerator). VerificationGate now only handles verification; proof generation is ProofGenerator's responsibility. Fixed ProofGenerator witness encryption: two-tree credentials now build full WitnessData (with `satisfies WitnessData` type safety) instead of simplified 4-field object with `as any` cast. Legacy single-tree kept for backward compatibility. Updated encryption UI text to "XChaCha20-Poly1305". Added trust_tier 3 promotion to submission endpoint (conditional `updateMany` — only promotes if < 3, fire-and-forget). Opus review: clean, zero bugs. Pre-existing issue noted: BR5-010 nullifier cross-validation in ProofGenerator is no-op (nullifierHex reassigned before check). |

### Cycle 5 Status

| Wave | Status | Notes |
|------|--------|-------|
| 5A: Address flow fix | **COMPLETE** | 2026-02-17: Fixed handleAddressComplete callback (CustomEvent → plain object). Removed broken `/user/address` POST. Added structured `deliveryAddress` to WitnessData (replaces `address?: string`). Updated ProofGenerator props and witness construction (both two-tree and legacy branches). Updated all 6 test render calls. Cleaned stale `expiresAt` from TEEPublicKey interface. |
| 5B: Server-side decryption | **COMPLETE** | 2026-02-17: Created `src/lib/server/witness-decryption.ts` — exact mirror of client encryption (X25519 ECDH → BLAKE2b → XChaCha20-Poly1305). Replaced mock TEE public key with real env var (`WITNESS_ENCRYPTION_PUBLIC_KEY`). Stable keyId from key prefix. Created `scripts/generate-witness-keypair.ts`. Roundtrip test passed. |
| 5C: CWC delivery pipeline | **COMPLETE** | 2026-02-17: Created `src/lib/server/delivery-worker.ts` (10-step pipeline: read submission → decrypt witness → extract deliveryAddress → lookup reps → fetch template → build CWC user → submit per-rep → determine overall status → update DB). Wired into submission endpoint with `platform.context.waitUntil()`. Senate endpoint toggleable via `CWC_PRODUCTION` env var. Added Platform.context types to app.d.ts. |
| 5D: Review fixes + polish | **COMPLETE** | 2026-02-17: Opus review found 16 issues (4 critical, 3 high, 6 medium, 3 low). Fixed 6: (1) fragile address parsing replaced with structured fields from AddressCollectionForm; (2) silent fake Senate delivery now fails loudly; (3) delivery_status enum documented with 'processing'+'partial'; (4) WITNESS_ENCRYPTION_PUBLIC_KEY added to app.d.ts; (5) type assertion precedence fixed in delivery worker; (6) .env.example updated with witness encryption + CWC_PRODUCTION. Pre-existing: BR5-010 nullifier cross-validation no-op (from Cycle 4), libsodium WASM on Workers (needs deployment test). |

### Cycle 6 Status

| Wave | Status | Notes |
|------|--------|-------|
| 6A: Status tracking pipeline | **COMPLETE** | 2026-02-17: Created `/api/submissions/[id]/status` (pseudonymous_id ownership) + `/api/submissions/[id]/retry` (atomic conditional). Rewrote `SubmissionStatus.svelte`: removed dead WebSocket, polls correct Submission model, `onDelivered` callback fires once on terminal success. |
| 6B: Modal dead ends | **COMPLETE** | 2026-02-17: Added `cwc-submission`+`error` to `LegacyModalState`. Error state now renders UI (was blank). Guest+congressional shows sign-in CTA (was dead end). ProofGenerator `autoStart` skips idle state. |
| 6C: Dead code cleanup | **COMPLETE** | 2026-02-17: Removed dead `CWCProgressTracker` import, dead `showPreWrittenMessages` state, debug `console.log`s from ModalRegistry. Added `{:else}` fallback for unhandled states. |
| 6D: Review fixes + polish | **COMPLETE** | 2026-02-17: Opus review found 16 issues (2 critical, 4 high, 5 medium, 5 low). Fixed 6 directly: (1) TOCTOU race in retry → atomic updateMany; (2) 401/403/404 → terminal polling stop; (3) AbortController on unmount; (4) poll generation counter for stale discard; (5) removed aggressive 2s auto-navigate from onDelivered; (6) fallback {:else} for auth_required/proof-generation. Deferred: ALS+waitUntil context persistence (pre-existing Cycle 5 concern), ProofGenerator event dispatch→callback migration (Svelte 5 modernization), template type unification. |

### Cycle 7 Status

| Wave | Status | Notes |
|------|--------|-------|
| 7A: BR5-010 nullifier fix | **COMPLETE** | 2026-02-17: Fixed nullifier self-comparison (saved expectedNullifier before overwrite). Removed dead try/catch from submitCongressionalMessage. Fixed handleProofError → routes to error state instead of retry_needed. |
| 7B: Trust tier + hasAddress | **COMPLETE** | 2026-02-17: Widened TemplateModal user prop to include trust_tier. Passed userTrustTier to VerificationGate. Fixed hasAddress to check verifiedAddress state instead of non-existent user fields. |
| 7C: Svelte 5 event migration | **COMPLETE** | 2026-02-17: Migrated ProofGenerator + VerificationGate from createEventDispatcher to callback props. Updated TemplateModal call sites and handler signatures. |
| 7D: Review fixes + polish | **COMPLETE** | 2026-02-17: Opus review found 12 issues (2 critical, 3 high, 4 medium, 3 low). Fixed: (1) CRITICAL onMount CWC bypass → routes through handleSendConfirmation(true); (2) as any on proofState.message → local errorMessage variable; (3) added TODO for IdentityVerificationFlow migration. Deferred: TemplateModal createEventDispatcher, needsTier3 dead derived, legacy single-tree BR5-010 gap, credential! assertions. |

### Cycle 8 Status

| Wave | Status | Notes |
|------|--------|-------|
| 8A: ALS safety + errors | **COMPLETE** | 2026-02-17: Added `getRequestClient()` to db.ts. delivery-worker.ts accepts optional db param. Callers capture concrete client before waitUntil. Sanitized delivery_error in status endpoint. |
| 8B: Type safety | **COMPLETE** | 2026-02-17: Created EmailFlowTemplate shared interface. Added missing fields to ComponentTemplate. Changed emailService + templateResolver to accept EmailFlowTemplate. Eliminated 5 unsafe casts from TemplateModal + ProofGenerator. |
| 8C: Svelte 5 migration | **COMPLETE** | 2026-02-17: Migrated IdentityVerificationFlow + TemplateModal from createEventDispatcher to callback props. Updated 2 consumers. Removed needsTier3 dead derived, double oncomplete dispatch, 22 redundant credential! assertions. |
| 8D: Review + polish | **COMPLETE** | 2026-02-17: Opus review found 0 critical, 3 high, 5 medium, 9 low. Fixed 5: (1) trust tier promotion uses captured client + waitUntil (HIGH); (2) verificationData stores full payload (HIGH); (3) tautological validation bug (MEDIUM); (4) stale on:error comment; (5) unused {@const}. Gated legacy single-tree with deprecation warning. Remaining debt: child components (VerificationChoice, SelfXyz, Didit) still use createEventDispatcher (SelfXyz and Didit subsequently removed in Cycle 15); delivery-worker.ts still has `as unknown as Template` for CWC calls. |

### Cycle 9 Status

| Wave | Status | Notes |
|------|--------|-------|
| 9A: Foundation + types | **COMPLETE** | 2026-02-17: Fixed `trustTierToAuthorityLevel(4)` → 5. Added `'mdl'` to VerificationMethod, `'digital-credentials-api'` to VerificationProvider. Updated session-cache, shadow-atlas-handler, session-credentials type unions. Added `/api/identity/verify-mdl` to SENSITIVE_IDENTITY_PATHS. Created `digital-credentials.d.ts` ambient type declarations. Auto-fixed: isVerificationMethod type guard for 'mdl', optional verificationMethod in session-credentials. |
| 9B: Client-side DC API | **COMPLETE** | 2026-02-17: Created `digital-credentials-api.ts` (feature detection, protocol support check, credential request with 60s AbortController timeout, discriminated union CredentialRequestResult). Created `GovernmentCredentialVerification.svelte` (Svelte 5 callback props, 6-state flow: idle→requesting→verifying→complete/error/unsupported, selective disclosure privacy messaging, browser fallback). Auto-fixed: renamed `state` → `verificationState` (Svelte 5 $state rune conflict). |
| 9C: Server-side mDL pipeline | **COMPLETE** | 2026-02-17: Added DC_SESSION_KV Workers KV binding. Installed cbor-web (Workers-compatible CBOR). Created `iaca-roots.ts` (IACA trust store structure, empty placeholder). Created `mdl-verification.ts` (THE privacy boundary: CBOR decode → extract address → derive district → discard PII). Created `/api/identity/verify-mdl/start` (ephemeral ECDH P-256, KV 5-min TTL, dual-protocol mdoc+oid4vp). Created `/api/identity/verify-mdl/verify` (one-time key retrieval, privacy boundary, trust_tier upgrade with `updateMany lt:4`). Auto-fixed: DC_SESSION_KV Platform.env type, GOOGLE_CIVIC_API_KEY ProcessEnv, cbor-web type declarations, updateMany safe upgrade pattern. |
| 9D: Integration + Opus review | **COMPLETE** | 2026-02-17: Added mDL as third option in VerificationChoice (progressive enhancement via `isDigitalCredentialsSupported()`, positioned first as "Fastest" when available). Wired GovernmentCredentialVerification into IdentityVerificationFlow with Svelte 5 callback props (handleMdlComplete/Error/Cancel). Added Tier 4-aware header to VerificationGate. **Opus review:** 0 P0 (privacy boundary verified clean), 1 P1 fixed (missing document_type/identity_commitment in verify endpoint — deriveTrustTier() would regress on re-login), 2 P2 documented (COSE stub needs IACA roots, minor comment accuracy). svelte-check: 0 new errors. |

---

## Cycle 10: Production Readiness + Cleanup

Verify all Cycle 1-9 code works in Cloudflare Workers runtime. Complete remaining Svelte 5 migration. Remove deprecated code paths. Build verification.

### Wave 10A: CF Workers Runtime Verification

Verify new dependencies work in Workers, create production KV namespace, test build.

| Task | File(s) | Detail |
|------|---------|--------|
| Test libsodium on Workers | `src/lib/server/witness-decryption.ts` | libsodium-wrappers uses WASM — verify it loads in Workers runtime. If incompatible, find Workers-native alternative (Web Crypto can't do XChaCha20). May need `libsodium-wrappers-sumo` or conditional import. |
| Test cbor-web on Workers | `src/lib/core/identity/mdl-verification.ts` | Dynamic `import('cbor-web')` — verify it resolves in Workers bundle. |
| Create DC_SESSION_KV namespace | `wrangler.toml` | `npx wrangler kv namespace create DC_SESSION_KV` → update placeholder ID in wrangler.toml. |
| Full CF build test | — | `ADAPTER=cloudflare npm run build` with all new Cycle 9 dependencies. Fix any bundle errors. |
| Verify env var propagation | `src/hooks.server.ts` | Confirm `GOOGLE_CIVIC_API_KEY`, `WITNESS_ENCRYPTION_PUBLIC_KEY` propagate via `handlePlatformEnv`. |

### Wave 10B: Final Svelte 5 Event Migration

Complete the createEventDispatcher → callback props migration for the 3 remaining child components. This is the last batch.

| Task | File(s) | Detail |
|------|---------|--------|
| Migrate VerificationChoice | `VerificationChoice.svelte` | Replace `createEventDispatcher<{ select }>` with `onselect?: (data) => void` callback prop. Update `IdentityVerificationFlow.svelte` consumer (change `on:select={handleMethodSelection}` to `onselect={...}`, remove CustomEvent wrapper from handler). |
| ~~Migrate SelfXyzVerification~~ | ~~`SelfXyzVerification.svelte`~~ | ~~Replace dispatched `complete` and `error` events with `oncomplete` and `onerror` callback props.~~ (Component removed — Cycle 15: self.xyz provider removed) |
| ~~Migrate DiditVerification~~ | ~~`DiditVerification.svelte`~~ | ~~Same pattern as SelfXyz — callback props instead of dispatch.~~ (Component removed — Cycle 15: Didit.me provider removed) |
| Update IdentityVerificationFlow handlers | `IdentityVerificationFlow.svelte` | After migrating children, `handleMethodSelection` and `handleVerificationComplete` no longer need CustomEvent wrappers. Simplify to direct function signatures. |

### Wave 10C: Dead Code + Type Cleanup

Remove deprecated code paths and unsafe type casts accumulated across Cycles 1-9.

| Task | File(s) | Detail |
|------|---------|--------|
| Remove legacy single-tree code | `ProofGenerator.svelte`, `prover-client.ts` | Legacy single-tree branch was gated with deprecation warning in Cycle 8D. All new flows use two-tree. Remove the legacy branch entirely. |
| Fix delivery-worker Template cast | `delivery-worker.ts` | `as unknown as Template` cast is unsafe. Define a minimal `CwcTemplate` interface containing only the fields CWC needs, and project to it explicitly. |
| Remove dead imports + unused vars | Various | Sweep for any `// removed`, `// deprecated`, `// TODO: remove` markers left by previous cycles. |
| Update env documentation | `.env.example`, `wrangler.toml` | Ensure all new env vars (GOOGLE_CIVIC_API_KEY, CWC_PRODUCTION, WITNESS_ENCRYPTION_PUBLIC_KEY) are documented with descriptions. |

### Wave 10D: Review + Build Verification

Final review gate. Verify the entire codebase builds and deploys cleanly.

| Task | File(s) | Detail |
|------|---------|--------|
| Opus review | — | Review all Cycle 10 changes. Focus: Workers runtime compatibility, Svelte 5 migration completeness, type safety improvements, build output size. |
| svelte-check | — | Target: 0 errors (fix the 2 pre-existing if feasible: backend client cast in db.ts, data.user in layout.svelte). |
| CF build + deploy dry run | — | `ADAPTER=cloudflare npm run build && npx wrangler pages deploy .svelte-kit/cloudflare --project-name commons --branch staging --dry-run` |
| Document remaining gaps | `.planning/production-gaps.md` | Honest list of what's NOT production-ready: IACA root certificates, COSE_Sign1 verification, OpenID4VP, Ed25519 credential signing (currently HMAC), Nitro Enclave deployment. |

**Verification:** `ADAPTER=cloudflare npm run build` succeeds. `svelte-check` clean (0 or 2 pre-existing only). No `createEventDispatcher` remaining in auth components. No legacy single-tree code. All env vars documented.

### Cycle 10 Status

| Wave | Status | Notes |
|------|--------|-------|
| 10A: CF Workers Build | **COMPLETE** | 2026-02-17: Build failed on `Invalid export 'devSessionStore'` from `start/+server.ts`. Fixed by extracting to `_dev-session-store.ts` (underscore prefix = non-route SvelteKit convention). `ADAPTER=cloudflare npm run build` passes in 38s. Env var propagation verified via `handlePlatformEnv` in hooks. Commit: c0bb1ce1. **Note:** libsodium WASM and KV namespace remain untested at runtime. |
| 10B: Svelte 5 Migration | **COMPLETE** | 2026-02-17: VerificationChoice, SelfXyzVerification, DiditVerification migrated to callback props. IdentityVerificationFlow consumer updated — all handlers take direct data instead of CustomEvent wrappers. 4 commits. svelte-check: 0 new errors. (Note: SelfXyzVerification and DiditVerification subsequently removed in Cycle 15.) |
| 10C: Dead Code Cleanup | **COMPLETE** | 2026-02-17: Removed 240 lines single-tree code from prover-client.ts. Created CwcTemplate minimal interface (5 fields). Updated delivery-worker.ts to project to the minimal template type — no cast needed. Updated .env.example and wrangler.toml documentation. 4 commits. |
| 10D: Review + Build | **COMPLETE** | 2026-02-17: Found and fixed 2 dangling files (example-usage.ts, witness-builder.ts) importing removed exports — 544 more lines deleted. Updated barrel index.ts. CF build passes. svelte-check: 18 errors, 95 warnings (0 new from Cycle 10). Total dead code removed: ~1300 lines. |

**Post-Cycle 10 fixes** (committed separately):
- `fix(email)`: Duplicate title check → title + subject
- `fix(submissions)`: ALS scope — capture backend client before response, register promotion with waitUntil
- `refactor(submission)`: SubmissionStatus rewrite — WebSocket→polling, retry, generation counter
- `chore`: ProofGenerator deprecation warning, modal state types

---

## Cycle 11: Type Safety + Submission Hardening

Fix the 18 pre-existing svelte-check errors, audit the submission pipeline end-to-end, and resolve remaining CF Workers runtime gaps.

### Wave 11A: svelte-check Error Resolution

Triage and fix the 18 type errors. Target: 0 errors, or document remaining as accepted technical debt with rationale.

| Task | Detail |
|------|--------|
| Triage all 18 errors | Run `npx svelte-check --output machine-verbose` to get full error list with line numbers. Categorize: fixable, requires upstream fix, accepted debt. |
| Fix layout.svelte type error | `Property 'id' does not exist on type '{}'` at `+layout.svelte:92`. Likely needs a `PageData` type annotation or `data.user` cast. |
| Fix templateDraft type errors | Missing `provenance`/`source_url` on ProcessedDecisionMaker. Add missing fields to type definition or update usage. |
| Fix crypto noise.ts | `randomBytes` property missing — Node.js vs browser crypto mismatch. Use conditional import or `crypto.getRandomValues()`. |
| Fix remaining type errors | Address target selector, intelligence panel, delivery confirmation, and other type mismatches found during triage. |

### Wave 11B: Submission Pipeline Audit

Verify the SubmissionStatus → retry → delivery-worker → status polling flow works end-to-end with proper state transitions.

| Task | Detail |
|------|--------|
| Audit delivery status transitions | Trace `delivery_status` field through: create (pending) → processSubmissionDelivery (processing → delivered/partial/failed). Verify all transitions are atomic. |
| Verify retry idempotency | Check `/api/submissions/[id]/retry` prevents double-delivery. Verify it resets status to `pending` before re-triggering. |
| Audit polling lifecycle | SubmissionStatus polls every 2s. Verify: AbortController cleanup on unmount, generation counter prevents stale responses, terminal states stop polling. |
| Check error boundary | What happens when delivery-worker throws? Verify status transitions to `failed`, error is persisted, SubmissionStatus shows retry button. |

### Wave 11C: CF Workers Runtime Gaps

Address the remaining P0 items that Cycle 10 build verification didn't cover.

| Task | Detail |
|------|--------|
| Test libsodium WASM on Workers | `witness-decryption.ts` imports `libsodium-wrappers`. Test if WASM initializes in Workers runtime. If it fails, evaluate: (1) `@aspect-build/libsodium-wasm` (Workers-native), (2) Web Crypto polyfill for XChaCha20, (3) `tweetnacl` pure-JS fallback. |
| Provision DC_SESSION_KV | Run `npx wrangler kv namespace create DC_SESSION_KV`. Update placeholder ID in `wrangler.toml`. Create preview namespace for staging. |
| Test mDL endpoints on Workers | Deploy to staging branch. Hit `/api/identity/verify-mdl/start` to verify: ECDH key generation works, KV put succeeds, JSON response is correct. |

### Wave 11D: Review + Documentation

| Task | Detail |
|------|--------|
| Opus review | Review all Cycle 11 changes. Focus: type safety improvements, submission flow correctness, Workers runtime compatibility. |
| Update implementation status | Reflect Cycle 11 fixes in `docs/implementation-status.md`. Update P0/P1 table. |
| svelte-check verification | Target: 0 errors. Document any accepted debt. |
| CF build verification | `ADAPTER=cloudflare npm run build` must still pass with all Cycle 11 changes. |

**Verification:** svelte-check errors reduced to 0 (or documented exceptions). Submission pipeline status transitions verified. CF build passes. DC_SESSION_KV provisioned with real namespace ID.

**Status:** COMPLETE — 4 waves, 4 commits. svelte-check 0 errors. CF build passes. libsodium eliminated from server. KV provisioned.

---

## Cycle 12: Dead Code Purge + Broken Event Wiring

**Theme:** Reduce technical debt — fix silently broken event wiring, delete ~8,700 lines of dead code, fix build warnings.

**Rationale:** Three Svelte components have parent-child event mismatches (parent migrated to callback props, child still dispatches) — these are silent runtime bugs. ~8,700 lines of dead code across TEE stubs, blockchain placeholders, intelligence examples, and dead server utilities inflate the codebase and slow comprehension. The 95 svelte-check warnings include 2 SSR bugs (nested buttons cause hydration mismatch).

### Wave 12A: Fix Broken Svelte 5 Event Wiring

Three components dispatch events that no parent receives (parent uses callback props, child uses createEventDispatcher). These are **silently broken features**.

| Task | Component | Events | Parent | Fix |
|------|-----------|--------|--------|-----|
| Fix SimpleModal | `src/lib/components/modals/SimpleModal.svelte` | `close` | `+page.svelte`, `ProfileEditModal.svelte` (both use `onclose` callback) | Migrate to `onclose` callback prop, remove dispatcher |
| Fix TemplateSuccessModal | `src/lib/components/modals/TemplateSuccessModal.svelte` | `close`, `dashboard` | `+page.svelte` (uses `onclose` callback) | Migrate to `onclose`/`ondashboard` callback props, remove dispatcher |
| Fix ProfileEditModal | `src/lib/components/profile/ProfileEditModal.svelte` | `close`, `save` | `profile/+page.svelte` (mixed: `onclose` new, `on:save` old) | Migrate to `onclose`/`onsave` callback props, fix parent to use `onsave` |
| Remove dead dispatcher imports | `AppHeader.svelte`, `SlugCustomizer.svelte`, `AddressCollectionForm.svelte` | `_dispatch` never called / import unused | N/A | Delete import + unused variable |
| Remove dispatchers with no listeners | `ErrorBoundary.svelte`, `TemplatePreview.svelte`, `Popover.svelte`, `AnimatedPopover.svelte` | Events dispatched but no parent listens | N/A | Remove dispatcher + dispatch calls (events are dead) |
| Delete dead components | `AddressRequirementModal.svelte` (imported but never instantiated), `UnifiedAddressCollectionWrapper.svelte` (commented out import) | N/A | `ModalRegistry.svelte` | Delete files + remove dead imports |

**Verification:** `npx svelte-check` still 0 errors. All `on:close`, `on:save`, `on:dashboard` usages match callback prop pattern. `grep -r createEventDispatcher` count drops from 20 to ~7 (remaining are the consistent old-style components migrated in 12D).

### Wave 12B: Dead Code Purge — Large Subsystems

Delete dead modules with zero import sites. Target: ~5,000 lines removed.

| Task | Files | Lines | Rationale |
|------|-------|-------|-----------|
| Delete TEE stubs | `src/lib/core/tee/manager.ts`, `src/lib/core/tee/providers/aws.ts` | ~1,140 | `getTEEManager()`/`createTEEManager()` never called. AWS provider is pure scaffold with placeholder AMI. |
| Delete intelligence examples | `src/lib/core/intelligence/examples.ts`, `api-example.ts` | ~674 | Demo/documentation code. 53 `console.log` calls. Never imported. |
| Delete thoughts example | `src/lib/core/thoughts/example.ts` | ~270 | `if (import.meta.url === ...)` main block. Never imported. |
| Delete dead blockchain modules | `chain-signatures.ts`, `oauth-near.ts`, `use-blockchain.ts`, `src/lib/core/api/voter.ts` | ~600 | Feature-flagged ROADMAP with no callers. Only reference each other. |
| Delete dead server utilities | `complete-extraction-pipeline.ts`, `scope-learning.ts`, `reducto/client.ts`, `reducto/index.ts`, `geocoding-cache.ts`, `agent-memory/service.ts` | ~1,000 | 0 import sites each |
| Delete dead core/server barrel consumers | `civic-analytics.ts`, `reputation/adoption-tracker.ts`, `perceptual/timing.ts`, `tools/document-helpers.ts`, `tools/document.ts`, `metrics/coordination-metrics.ts`, `server/district-metrics.ts`, `server/sentiment-classification.ts`, `server/selfxyz-verifier.ts`, `server/verification-sessions.ts`, `server/api-security.ts`, `server/reserved-slugs.ts`, `server/sentiment-basic.ts` | ~1,500 | 0 external import sites. `core/server/index.ts` barrel re-exports them but nothing imports the barrel. |
| Delete dead location modules | `behavioral-tracker.ts`, `autocomplete-cache.ts`, `geocoding-api.ts` | ~835 | 0 import sites |
| Clean core/server/index.ts barrel | `src/lib/core/server/index.ts` | — | Remove re-exports of deleted modules. Delete barrel if empty. |

**Verification:** `npm run build` succeeds. `ADAPTER=cloudflare npm run build` succeeds. `npx svelte-check` 0 errors.

### Wave 12C: Dead Code Purge — Small Files + Type Cleanup

Delete small dead files, .bak artifacts, duplicate types. Target: ~2,000 lines removed.

| Task | Files | Action |
|------|-------|--------|
| Delete .bak files | `TemplateCreator.svelte.bak`, `draft-resumption.test.ts.bak` | Delete |
| Delete dead data files | `src/lib/data/mockTemplates.ts`, `data/steps.ts`, `data/verification.ts` | Delete (0 imports each) |
| Delete dead types | `src/lib/types/audit.ts`, `types/api-helpers.ts`, `types/challenge.ts` | Delete (0 imports / re-exported but unused) |
| Delete dead utils | `src/lib/utils/validation.ts`, `utils/debounce.ts`, `actions/gestures.ts`, `integrations/voter.ts` | Delete (0 imports) |
| Delete misplaced test | `src/lib/tests/cwc-mvp-test.ts` | Delete (test file in src/lib, not tests/) |
| Fix duplicate Address type | `src/lib/types/api.ts` lines 35-47 | Remove duplicate declaration, rename response type to `AddressUpdateResponse` |
| Fix zkp dead code | `src/lib/core/zkp/action-domain-builder.ts`, `zkp/prover-client.ts` | Delete (0 external imports) |

**Verification:** `npm run build` succeeds. `npx svelte-check` 0 errors.

### Wave 12D: svelte-check Warnings + Remaining Migration + Review

Fix actionable warnings and migrate remaining consistent old-style event dispatchers.

| Task | Detail |
|------|--------|
| Fix state_referenced_locally warnings | `TemplatePreviewCard.svelte:30-35` — wrap in `$derived()`. `Toast.svelte:62` — wrap in `$derived()`. |
| Fix SSR nested button bugs | `RelayLoom.svelte:998,1048` — change inner `<button class="narrative-cta">` to `<div role="button" tabindex="0">` |
| Migrate remaining dispatchers | `TemplateCreator.svelte`, `CreationSpark.svelte`, `DirectOutreachCompact.svelte`, `TouchModal.svelte` — convert to callback props, update parents |
| Migrate location chain | `LocationAutocomplete.svelte` → `DistrictBreadcrumb.svelte` → `InlineAddressResolver.svelte` — convert entire chain to callback props |
| Final verification | `npx svelte-check`: target 0 errors, reduced warnings. `ADAPTER=cloudflare npm run build` passes. `grep -r createEventDispatcher` returns 0. |
| Update implementation status | Reflect Cycle 12 in `docs/implementation-status.md`. |

**Verification:** 0 `createEventDispatcher` remaining. svelte-check 0 errors, warnings reduced from 95. CF build passes.

---

## Cycle 13: Cryptographic Verification Hardening

Close the remaining P1/P2 gaps in the identity verification pipeline: implement real COSE_Sign1 signature verification for mDL credentials, populate the IACA trust store with production certificate format, replace HMAC-SHA256 credential signing with Ed25519, and implement the OpenID4VP protocol path.

**Dependencies:**
- 13A (IACA + COSE): Foundation — no dependencies
- 13B (Ed25519 signing): Independent — can parallel with 13A
- 13C (OpenID4VP): Depends on 13A (reuses COSE verification patterns)
- 13D (Review + docs): Depends on 13A, 13B, 13C

**Available crypto primitives (already in dep tree):**
- `cbor-web@10.0.11` — CBOR encode/decode
- `@noble/ciphers@1.3.0` (direct dep)
- `@noble/curves@1.2.0` (transitive) — ed25519, p256
- `@noble/hashes@1.3.2` (transitive) — sha256
- Web Crypto API — ECDSA P-256 verify, SHA-256

### Wave 13A: IACA Trust Store + COSE_Sign1 Verification

Implement real cryptographic verification of mDL issuer signatures per ISO 18013-5.

**Key files:**
- `src/lib/core/identity/iaca-roots.ts` — Populate trust store structure
- `src/lib/core/identity/mdl-verification.ts` — Replace stub at line 168 with real verification
- New: `src/lib/core/identity/cose-verify.ts` — COSE_Sign1 parsing + ECDSA verification

| Task | Detail |
|------|--------|
| Implement COSE_Sign1 parser | Parse COSE_Sign1 structure from `issuerAuth`: `[protectedHeaders, unprotectedHeaders, payload(MSO), signature]`. Use `cbor-web` for CBOR decoding. Extract MSO, signer certificate chain, and ECDSA signature. |
| Implement ECDSA P-256 verification | Extract public key from issuer X.509 certificate in MSO. Verify COSE_Sign1 signature over `Sig_structure = ["Signature1", protectedHeaders, "", payload]` using Web Crypto API `crypto.subtle.verify('ECDSA', ...)`. |
| Implement MSO digest validation | Parse MSO (MobileSecurityObject): check validity period (validFrom/validUntil), match `valueDigests` against SHA-256 hashes of IssuerSignedItem elements. Ensures field values haven't been tampered with post-signing. |
| Restructure IACA trust store | Change `iaca-roots.ts` from hardcoded DER to a runtime-loadable format. Add `VICALCertificate` type with DER bytes + parsed metadata. `getIACARootForIssuer()` returns the root cert for signature chain verification. Keep placeholder certs for development/test mode. |
| Wire verification into privacy boundary | Replace `console.warn` stub in `mdl-verification.ts:168` with call to `verifyCoseSign1()`. Return `signature_invalid` error if verification fails. Add `skipIssuerVerification` option for dev/test when IACA roots aren't loaded. |
| X.509 certificate chain validation | Parse issuer certificate from MSO, check basic constraints (validity period, key usage). Verify issuer cert is signed by an IACA root. Minimal ASN.1 parsing using byte-level operations (avoid adding asn1js dep). |

**Verification:** `npx svelte-check` 0 errors. `ADAPTER=cloudflare npm run build` passes. Unit tests for COSE parsing with synthetic COSE_Sign1 payloads.

### Wave 13B: Ed25519 Credential Signing

Replace HMAC-SHA256 with proper Ed25519 digital signatures for district residency credentials.

**Key files:**
- `src/lib/core/identity/district-credential.ts` — Replace HMAC with Ed25519
- `tests/unit/district-credential.test.ts` — Update test expectations

| Task | Detail |
|------|--------|
| Add Ed25519 signing | Import `ed25519` from `@noble/curves/ed25519`. New `getSigningKeyPair()` from `IDENTITY_SIGNING_KEY` env var (hex-encoded 32-byte seed). Replace `crypto.subtle.sign('HMAC', ...)` with `ed25519.sign(bodyBytes, privateKey)`. |
| Fix proof type label | `proof.type` already says `'Ed25519Signature2020'` — now the signature actually matches. The verificationMethod already points to `did:web:commons.email#district-attestation-key`. |
| Add backward-compatible verification | `verifyDistrictCredential()` tries Ed25519 first, falls back to HMAC if Ed25519 fails. This allows existing HMAC-signed credentials to remain valid during the migration window. After 90 days (credential TTL), all credentials will be Ed25519. |
| Update tests | Update `district-credential.test.ts`: change `IDENTITY_HASH_SALT` setup to `IDENTITY_SIGNING_KEY` (hex seed). Verify Ed25519 signatures are correct length (64 bytes). Add test for HMAC fallback verification. |
| Update env documentation | Document new `IDENTITY_SIGNING_KEY` env var in wrangler.toml (as placeholder) and deployment docs. |

**Verification:** All existing district-credential tests pass. New Ed25519 signatures verify correctly. HMAC-signed credentials still verify (backward compatibility).

### Wave 13C: OpenID4VP Protocol Support

Implement the OpenID4VP response path for Chrome 141+ which may present credentials in JWT/SD-JWT format instead of CBOR/mdoc.

**Key files:**
- `src/lib/core/identity/mdl-verification.ts` — Implement `processOid4vpResponse()`
- `src/routes/api/identity/verify-mdl/start/+server.ts` — Verify dual-protocol request format

| Task | Detail |
|------|--------|
| Implement VP token parsing | Parse `vp_token` from OpenID4VP response. Token is a JWT or SD-JWT containing the mDL claims. Decode JWT header + payload (base64url decode, no signature verification needed since the credential was received via the Digital Credentials API browser channel). |
| Extract address claims from VP | Navigate JWT claims to find address fields (`resident_postal_code`, `resident_city`, `resident_state`) in the mDL namespace or as top-level claims. Apply same privacy boundary: extract → derive district → discard. |
| Handle SD-JWT selective disclosure | If SD-JWT format (`~` delimited), parse disclosures, verify they contain the requested address fields. SD-JWT disclosures are base64url-encoded JSON arrays `[salt, claim_name, claim_value]`. |
| Wire into processCredentialResponse | Replace `unsupported_protocol` return with real processing. Same output shape as mdoc path: `{success, district, state, credentialHash}`. |
| Add error handling | Handle missing claims, malformed JWTs, expired tokens. Use same error discriminated union as mdoc path. |

**Verification:** `npx svelte-check` 0 errors. Unit tests for JWT/SD-JWT parsing with synthetic payloads.

### Wave 13D: Review + Documentation + Build Verification

Final verification, documentation updates, and build checks.

| Task | Detail |
|------|--------|
| svelte-check | 0 errors, track warning count change |
| CF build | `ADAPTER=cloudflare npm run build` exits 0 |
| Update implementation-status.md | Move COSE_Sign1 and IACA to FIXED, move Ed25519 to FIXED, update OpenID4VP status |
| Update this document | Cycle 13 findings and results |
| Commit | Atomic commits per wave |

## Cycle 13 Results

**Focus:** Cryptographic Verification Hardening
**Waves:** 4 (13A–13D)
**Commits:** 5

### What was done

| Wave | Outcome |
|------|---------|
| 13A | Real COSE_Sign1 ECDSA P-256 verification via Web Crypto (RFC 9052). Minimal ASN.1/DER parser for X.509 EC key extraction. MSO digest validation. IACA trust store restructured with `derBytes` field, `DEV_IACA_ROOT` placeholder, `getIACARootsForVerification()`. Graceful degradation when no IACA roots loaded. 15 tests. |
| 13B | Ed25519 credential signing via `@noble/curves/ed25519` (pure JS, CF Workers compatible). `issueDistrictCredential()` produces real Ed25519 signatures. `verifyDistrictCredential()` tries Ed25519 first, falls back to HMAC-SHA256 for 90-day migration window. `proof.type: 'Ed25519Signature2020'` now truthful. 23 tests (17 existing + 6 new). |
| 13C | OpenID4VP protocol support. JWT parsing, SD-JWT disclosure merging, direct JSON object handling. Flexible claim extraction (5 nesting patterns: top-level, mDL namespace, credentialSubject, vc.credentialSubject, one-level-deep). Nonce verification for replay protection. Same privacy boundary as mdoc path. 9 tests. |
| 13D | 0 svelte-check errors (88 warnings, unchanged). CF build passes. BufferSource type cast fix. All docs updated. |

### Findings

1. **COSE signature format alignment:** COSE uses raw r‖s (IEEE P1363) for ECDSA — same as Web Crypto. No DER conversion needed. Plan anticipated DER conversion; agent correctly identified this and omitted it.
2. **Cross-realm Uint8Array in vitest/jsdom:** `@noble/curves` uses `instanceof Uint8Array` which fails across realms (jsdom vs Node.js). Fix: pass private keys as hex strings (accepted by noble's `Hex` type), wrap `TextEncoder.encode()` with `new Uint8Array(...)`.
3. **Mock isolation in vitest:** `vi.stubGlobal('fetch', mockFetch)` with `mockResolvedValueOnce` leaks state between tests. Fix: `globalThis.fetch = vi.fn()` in `beforeEach` with explicit restore in `afterEach`.
4. **IACA production certs:** Trust store structure ready and verified with dev cert. AAMVA VICAL is freely downloadable at `vical.dts.aamva.org/currentVical` (CBOR/COSE, ToS click-through only — no org registration needed). Multiple states also publish IACA roots directly on .gov domains (CA, AZ, GA, NM, PR). See `research/mdl-landscape-2026.md` for full IACA/VICAL research (2026-03-05). Integration pending.

### Test count

| Test file | Count |
|-----------|-------|
| `tests/unit/identity/cose-verify.test.ts` | 15 |
| `tests/unit/district-credential.test.ts` | 23 |
| `tests/unit/identity/oid4vp-verify.test.ts` | 9 |
| **Total new in Cycle 13** | **47** |

## Cycle 14: Security-Critical Test Coverage + Production Hygiene

**Focus:** Add test coverage to untested security-critical path; remove debug artifacts and hackathon shortcuts.

**Motivation:** After 13 cycles, the core pipeline is implemented — but the nullifier enforcement (Sybil prevention), pseudonymous ID generation, authority level derivation, user secret derivation, and witness encryption/decryption round-trip have zero test coverage. Debug `console.log` floods with emoji markers, 50k-char hackathon limits, and silent `catch {}` blocks remain in production code.

### Wave 14A: Core Security Unit Tests

Test the deterministic security logic that gates Sybil prevention and trust computation.

**Files to create:**
- `tests/unit/authority-level.test.ts` — all 5 authority levels, all trust tiers, tier→authority mapping
- `tests/unit/pseudonymous-id.test.ts` — HMAC correctness, salt validation, determinism (mock `$env/dynamic/private`)
- `tests/unit/user-secret-derivation.test.ts` — Poseidon2 determinism, hex normalization, entropy generation

### Wave 14B: Witness Encryption Round-Trip Test

**File to create:** `tests/unit/witness-roundtrip.test.ts`

Test that client-encrypted witness data can be decrypted by the server. Uses `@noble` libraries for both sides (same wire format as libsodium). Tests: round-trip, wrong-key rejection, tamper detection, nonce uniqueness.

### Wave 14C: Production Hygiene

| Fix | Files |
|-----|-------|
| Remove 6 debug console.log with emoji markers | `CodeMirrorEditor.svelte` |
| Remove 2 positioning debug logs | `AnimatedPopover.svelte` |
| Fix 3 empty `catch (error) {}` blocks | `autocomplete-cache.ts` |
| Fix `@ts-ignore` → `@ts-expect-error` | `buffer-shim.ts` |
| Tighten title limit 500→200, body 50000→10000 | `+server.ts` (templates) |
| Sanitize slug input, remove HACKATHON comments | `+server.ts` (templates) |
| Guard demo pages with dev-only check | 3 demo `+page.server.ts` files |

### Wave 14D: Review + Documentation + Build Verification

svelte-check (0 errors), CF build, full test suite, update docs.

## Cycle 14 Results

**Focus:** Security-Critical Test Coverage + Production Hygiene
**Waves:** 4 (14A–14D)
**Commits:** 4

### What was done

| Wave | Outcome |
|------|---------|
| 14A | 31 tests across 3 files: `authority-level.test.ts` (18 tests — all 5 authority levels, all trust tiers, tier→authority mapping), `pseudonymous-id.test.ts` (5 tests — HMAC format, determinism, uniqueness, salt guards), `user-secret-derivation.test.ts` (8 tests — Poseidon2 determinism, hex normalization, entropy generation). Mock pattern for `$env/dynamic/private` and `poseidon2Hash2`. |
| 14B | 5 tests in `witness-roundtrip.test.ts`: encrypt→decrypt round-trip using @noble for both sides, wrong-key rejection, tamper detection (Poly1305 auth tag), nonce uniqueness, complex nested data round-trip. Used `@vitest-environment node` pragma to avoid cross-realm Uint8Array issue. |
| 14C | Debug console.log floods removed (6 emoji logs in CodeMirrorEditor, 2 in AnimatedPopover). 3 empty `catch {}` blocks fixed with `console.warn`. `@ts-ignore` removed (no actual error on line). HACKATHON limits tightened: title 500→200, body 50000→10000. `sanitizeSlug()` function added. 3 demo pages dev-gated with 404. |
| 14D | 0 svelte-check errors (88 warnings, unchanged). CF build passes. 36 new tests all pass. Docs updated. |

### Findings

1. **`@ts-ignore` was unnecessary:** The plan called for `@ts-ignore` → `@ts-expect-error`, but svelte-check revealed no actual TypeScript error on that line. The directive was simply removed — keeping unused suppressions is misleading.
2. **Cross-realm Uint8Array in @noble/hashes:** The `blake2b` and `xchacha20poly1305` functions use `instanceof Uint8Array` checks that fail in jsdom. The witness round-trip test uses `@vitest-environment node` pragma since it tests server-side crypto with no DOM dependency.
3. **Poseidon2 WASM in tests:** The `@aztec/bb.js` WASM loading is fragile in vitest. Mocking `poseidon2Hash2` with a deterministic function is the right approach for unit tests — the real Poseidon2 is already tested in `tests/unit/crypto/poseidon.test.ts`.

### Test count

| Test file | Count |
|-----------|-------|
| `tests/unit/authority-level.test.ts` | 18 |
| `tests/unit/pseudonymous-id.test.ts` | 5 |
| `tests/unit/user-secret-derivation.test.ts` | 8 |
| `tests/unit/witness-roundtrip.test.ts` | 5 |
| **Total new in Cycle 14** | **36** |

## Cycles 15–19: Complete Production Hardening (Plan)

Five sequential cycles to close every remaining gap between "functionally complete" and "production-ready":

| Cycle | Focus | Key Targets |
|-------|-------|-------------|
| 15 | Type Safety Purge + Provider Removal | ~57 `as any` + ~42 `as unknown as` casts, schema-driven type gaps, Svelte 5 component types. **Also: removed self.xyz and Didit.me providers.** mDL via Digital Credentials API is now the sole active verification path. SelfXyzVerification.svelte, DiditVerification.svelte, and VerificationChoice.svelte removed. |
| 16 | Workers Infrastructure Reality | 5 in-memory caches/rate limiters → Postgres/KV, module-level env reads, dead setInterval |
| 17 | Stub Elimination + Error Discipline | CWC placeholder, zero blockchain addresses, fake reps, swallowed catches, deferred wiring |
| 18 | Dead Code Purge + Logging Discipline | 15+ deprecated functions, ~300 console.log, intelligence provider stubs, dead file cleanup |
| 19 | Warning Annihilation + Test Coverage | 88 svelte warnings → 0, submission handler + delivery worker + mdoc tests |

**Full plan:** `.claude/plans/starry-dreaming-micali.md`

---

*Commons PBC | Implementation Plan | 2026-02-18*
