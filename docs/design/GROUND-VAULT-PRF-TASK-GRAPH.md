# Ground Vault PRF Task Graph

**Status:** implementation tasks complete; congressional launch gate remains closed
**Date:** 2026-05-01
**Decision:** Option A, with Option D as a first-class fallback.

Option A is a passkey WebAuthn PRF unlock path for a private address vault.
Option D is address re-entry when PRF unlock is unavailable, unsupported,
lost, or the local browser record was erased.

This document reconciles the profile-page ground state with the Commons design
system, the CWC delivery requirement, and the current architecture. It is not a
claim that PRF is universally available. PRF is a best path where the browser,
authenticator, passkey provider, and credential all support it.

Launch state: the CWC/ground delivery code path is implemented, but not publicly
launched while `FEATURES.CONGRESSIONAL=false`. Runtime loaders exclude CWC
templates from browse/home discovery and return 404 for direct CWC template
routes. If the flag is enabled later, `/api/submissions/create` still requires
Tier 4+ proof authority before congressional delivery can run.

## Ground Rules

1. A verified constituent state never implies the address vault is currently
   unlockable on this device.
2. Congress/CWC delivery requires plaintext address fields in the government
   POST body. The pragmatic cypherpunk line is: encrypted at rest, user-unlocked
   for delivery, plaintext only in memory at the delivery boundary.
3. The original normalized address must persist, but only as encrypted vault
   material. The server may persist disclosed location metadata: cell/H3,
   district slots, district commitment, atlas root/version, source, confidence,
   timestamps, and linked credential ids.
4. Profile copy follows `docs/design/voice.md`: primary UI states are civic
   facts, not crypto jargon. PRF, DEK, HKDF, H3, and trust-tier internals belong
   in secondary detail.
5. Until the TEE boundary is actually deployed, docs and UI must not say
   "server never sees the address" for flows that geocode server-side or deliver
   through `LocalConstituentResolver`.

## Browser PRF Landscape

The relevant support gate is WebAuthn `get()` with the `prf` extension, not only
credential creation. Vault unlock requires later PRF evaluation during
authentication.

| Surface | Current read |
| --- | --- |
| W3C WebAuthn Level 3 | Defines `prf` for registration and authentication. Outputs are 32-byte PRF evaluations and may be used as symmetric key material. |
| MDN WebAuthn extensions | `prf` takes one or two salts and can support key rotation by evaluating current and next salt in one ceremony. Registration-time PRF output is less widely supported than assertion-time flows. |
| Capability detection | `PublicKeyCredential.getClientCapabilities()` can report extension support using `extension:prf`, but client support does not guarantee the selected authenticator will process PRF. |
| Can I Use: `create()` PRF | Broad desktop/mobile support, including Safari 18+. This is not enough for vault unlock. |
| Can I Use: `get()` PRF | Chrome/Edge 116+, Firefox 139+, Samsung Internet 24+. Safari and iOS Safari are listed unsupported for `get()` PRF. |
| Product precedent | Bitwarden treats PRF vault unlock as conditional on browser plus authenticator support and falls back to a separate unlock secret when PRF is unavailable. |
| Recovery reality | FIDO's synced-passkey guidance still requires alternate recovery methods. Device-bound passkeys can be lost; synced passkeys can be unavailable on a new provider/device. |

Sources:
- W3C WebAuthn Level 3: https://www.w3.org/TR/webauthn-3/#prf-extension
- MDN WebAuthn extensions: https://developer.mozilla.org/en-US/docs/Web/API/Web_Authentication_API/WebAuthn_extensions#prf
- MDN `getClientCapabilities()`: https://developer.mozilla.org/en-US/docs/Web/API/PublicKeyCredential/getClientCapabilities_static
- Can I Use `get()` PRF: https://caniuse.com/mdn-api_credentialscontainer_get_publickey_option_extensions_prf
- Can I Use `create()` PRF: https://caniuse.com/mdn-api_credentialscontainer_create_publickey_option_extensions_prf
- Bitwarden passkey unlock requirements: https://bitwarden.com/help/login-with-passkeys/
- FIDO synced passkey deployment guidance: https://fidoalliance.org/wp-content/uploads/2024/05/Synced-Passkey-Deployment_-Emerging-Practices-for-Consumer-Use-Cases_2024-May-31.pdf

## Current Architecture Gaps

The current system has useful pieces, but not the target model.

| Area | Current reality | Target correction |
| --- | --- | --- |
| Address persistence | `commons-address` IndexedDB cache encrypted under a device master key. Browser storage loss destroys local address availability. | Server-side encrypted `groundVaults` ciphertext, unlocked by PRF wrapper when possible or recreated by re-entry. |
| Local encryption root | `commons-keystore` stores raw device derivation material in IndexedDB. | Treat as legacy. Migrate or retire into PRF-wrapped vault envelopes. |
| Cell/H3 | Location APIs return cell ids, but `districtCredentials` do not persist cell/root/source/confidence. | Persist first-class `groundCellMetadata` linked to active credential. |
| Passkeys | UI references auth endpoints, but passkey support is disabled/auth-only and no PRF wrapper model exists. | Implement passkey registration/authentication with PRF extension handling and multiple vault wrappers. |
| Verification paths | Profile/onboarding/template/campaign flows duplicate district verification; public campaign path can self-report location. | One `GroundService` write path. Public/self-reported location remains labeled separately. |
| Delivery | Encrypted witness is decrypted by `LocalConstituentResolver` until TEE deployment. | Keep delivery boundary honest, add per-recipient receipts, enforce witness TTL and cleanup. |
| Profile copy | Trust tier, saved address state, and proof credentials are conflated. | Split account proof, ground vault, local cache, and delivery readiness. |

## Canonical Model

### AccountProof

Authentication and trust evidence: session, passkey public key, identity
commitment, trust tier, district credential id. This answers who the account is
and what has been proven. It does not answer whether the address vault can be
decrypted on the current device.

### GroundVault

Encrypted normalized address payload. The payload includes the original
normalized address required for CWC, resolve-result provenance, schema version,
and created/updated timestamps. The server stores only ciphertext and envelope
metadata.

The vault uses a random DEK. Each PRF-capable credential gets a separate
wrapper: PRF output -> HKDF domain-separated wrapping key -> wrapped DEK. If all
wrappers are dead, the vault becomes unreadable and transitions to re-entry.

### GroundCell

Disclosed location artifact. Contains cell/H3, district slots, district
commitment, atlas root/version, source, confidence, issued/expires timestamps,
and credential linkage. This is location disclosure, not plaintext address
storage. It supports profile explanation, delivery eligibility, and reporting
without decrypting the address.

### DeviceGroundCache

IndexedDB cache for speed and offline continuity. It is not authoritative. Cache
loss is represented as "saved address locked" or "re-enter address", not as loss
of verification.

### DeliveryWitness

Short-lived encrypted witness for CWC/proof delivery. It must be retained long
enough for retry, then cleaned. Plaintext address exists only during witness
construction and the government delivery POST.

## State Machines

### Account Proof

```text
guest
  -> signed_in
  -> address_attested
  -> identity_checked
  -> proof_ready
  -> government_credential
```

User-facing labels should be plain:

| Internal | Profile label |
| --- | --- |
| signed_in | Signed in |
| address_attested | Address verified |
| identity_checked | Identity checked |
| proof_ready | Proof ready |
| government_credential | Government credential |

### Ground Vault

```text
absent
  -> pending_create
  -> locked
  -> unlocked
  -> rewrap_needed
  -> retired

locked
  -> unavailable
  -> pending_create
```

User-facing labels:

| Internal | Profile label | Action |
| --- | --- | --- |
| unlocked | Address saved | Re-ground address |
| locked | Saved address locked | Unlock saved address |
| unavailable | Address needs re-entry | Re-enter address |
| rewrap_needed | Address vault needs update | Update saved address |
| retired | Address record retired | Enter address |

### Ground Restore

```text
start
  -> capability_check
  -> prf_unlock
  -> same_cell_restore
  -> ready

capability_check
  -> reenter_address
  -> server_resolve_signed
  -> same_cell_restore
  -> ready

server_resolve_signed
  -> different_cell_reground
  -> attest
  -> persist_vault_and_cell
  -> retire_old_ground
  -> ready
```

Server-side resolution and comparison are mandatory. The client may present the
result, but it cannot be the authority for same-cell restore or new-cell
re-grounding. Drift tolerance must be specified before implementation.

### Delivery

```text
select_action
  -> require_ground
  -> unlock_or_reenter
  -> build_witness
  -> generate_proof
  -> submit_cwc
  -> receipt_pending
  -> delivered | partial | failed | demo
  -> witness_cleanup
```

Profile and send UI must distinguish queued, delivered, partial, failed, and
demo. "Delivered" requires an actual upstream delivery receipt.

## Task Graph

```text
T0 PRF reality audit
  -> T1 data model
  -> T2 PRF crypto service
  -> T3 canonical GroundService API
  -> T4 profile and send UI states
  -> T5 delivery integration
  -> T6 migration and retired-path removal
  -> T7 tests, telemetry, release gate

T0 also feeds T4 because Option D may be the dominant mobile path.
T1, T2, and T3 must converge before any UI claims saved address recovery.
T5 cannot ship without T3 because delivery must read canonical ground state.
T6 is not cleanup; it is part of the architecture.
```

## Implementation Ledger

| Task | Status | Completion | Findings | Review |
| --- | --- | --- | --- | --- |
| T0 PRF reality audit | Complete | Added `src/lib/core/identity/webauthn-prf.ts` and `tests/unit/identity/webauthn-prf.test.ts`. | PRF vault unlock depends on WebAuthn `get()` extension support, not only registration support. Existing passkey UI is feature-gated and only `/api/auth/passkey` DELETE exists in this checkout; register/authenticate routes still need implementation before vault unlock can be wired. `getClientCapabilities()` is only a client hint; a real assertion result is still required to prove selected-authenticator PRF output. | Passed focused Vitest, source-file type check, and diff whitespace check. Repo-wide `svelte-check` still fails on unrelated existing diagnostics. |
| T1 data model | Complete | Added `groundVaults`, `groundCellMetadata`, `passkeyVaultWrappers`, `submissionDeliveryReceipts`, and `convex/ground.ts` atomic bundle persistence. | Current auth passkey state is still single-field-on-user, so `persistGroundBundle` only accepts a wrapper for the currently registered passkey until a one-to-many passkey credential table exists. Active credential links use `districtCredentials._id`, not `credentialHash`, because commitment-only rows may have empty hashes. | Passed schema/source-file type check, `convex codegen --typecheck=disable`, and diff whitespace check. Normal Convex typecheck still fails on existing repo-wide Convex errors outside this slice. |
| T2 PRF crypto service | Complete | Added `ground-vault-crypto.ts`, base64url helpers, server HMAC proof helpers, WebAuthn register/authenticate routes, Convex passkey ceremony state, SimpleWebAuthn v13-compatible passkey storage fields, and focused vault crypto tests. | Register/authenticate routes were absent and are now implemented for the UI's existing shape. SimpleWebAuthn's browser helper forwards extension objects without converting PRF salts, so vault unlock still needs a dedicated client ceremony path when T4 wires PRF unlock. `passkeyVaultWrappers` now persists the non-secret PRF salt as well as the salt id so new devices can request the same PRF output. Passkey login is single-credential until passkeys are normalized into a one-to-many credential table. | Passed focused Vitest, targeted crypto/Convex source-file type checks, `convex codegen --typecheck=disable`, filtered Svelte route check, and diff whitespace check. Filtered Svelte check still reports Convex `TS2589` instantiation-depth diagnostics in new Convex builders, matching the existing repo-wide Convex typecheck failure mode. |
| T3 canonical GroundService API | Complete | Added `src/lib/server/ground/ground-service.ts`, wrapped `/api/identity/verify-address` behind it, exposed `/api/ground/state` and `/api/ground/bundle`, and made `api.users.verifyAddress` return the created district credential id for vault/cell linkage. | Existing UI callers can keep their current `verify-address` payloads while T4 migrates them. Public campaign district checks are still a separate non-persistent path. Delivery inspection found active CWC delivery uses `submissions` witness fields, not `encryptedDeliveryData`; GroundService T5 must expose delivery readiness, canonical ground metadata, witness construction, and per-recipient receipt writers. | Passed focused Vitest, filtered Svelte/project checks for new GroundService/routes, and diff whitespace check. Convex filtered check still reports `TS2589` instantiation-depth diagnostics in Convex builders, consistent with the existing repo-wide Convex typecheck failure mode. |
| T4 profile and send UI states | Complete | Profile now reads canonical ground state and distinguishes Address saved, Saved address locked, Address needs re-entry, and No address verified. Send UI now gates CWC delivery on a readable address and shows a restore/re-entry state when verification exists but local plaintext is unavailable. Profile signal copy now uses plain verification levels instead of the rejected signal-strength language. | Primary UI avoids crypto jargon and distinguishes verified status from vault unlockability. UI shows disclosed district/cell metadata when available even if plaintext address is locked or absent locally. Prior absolute server-privacy phrasing was removed because government delivery can require plaintext disclosure at the delivery boundary. PRF unlock remains a T6 implementation slice, so T4 routes unavailable local address state to Option D re-entry instead of claiming unlock is available. | Passed filtered Svelte check for profile/send/store files, diff whitespace check, and rejected-copy sweep. |
| T5 delivery integration | Complete, launch-gated | Delivery boundary mapping complete. `deliverToCongress()` writes sanitized per-recipient `submissionDeliveryReceipts`, status polling returns receipt rows, and `SubmissionStatus` displays delivered, partial, failed, and demo receipt states. | Active CWC delivery uses `submissions.encryptedWitness`, `LocalConstituentResolver.resolve()`, and `deliverToCongress()`, but public CWC runtime remains disabled by `FEATURES.CONGRESSIONAL=false`. `encryptedDeliveryData`, `store-blob`, and `retrieve-blob` are deprecated paths and are not used by the implemented delivery/status path. Receipts store recipient/provider/status ids and safe error codes only; no XML, request body, plaintext address, or upstream response body is persisted. | Passed `convex codegen --typecheck=disable`, filtered Svelte check, diff whitespace check, and deprecated-path sweep on touched delivery/status files. Raw targeted Convex `tsc` remains blocked by existing generated-api `TS2589`/circular type errors. |
| T6 migration and retired-path removal | Complete | Added a client ground-vault persistence helper and wired address re-entry/re-grounding paths to persist `groundVaults` and `groundCellMetadata` through `/api/ground/bundle` after successful address attestation. Added logged-in passkey assertion route, opportunistic PRF wrapper creation, and send-flow passkey unlock for active wrappers. Retired legacy encrypted-blob HTTP routes with explicit `410 Gone` responses. | Legacy/device-key local cache remains as a speed/delivery cache, but re-entry no longer stops there; it writes the canonical encrypted server vault. PRF is conditional: if assertion-time PRF output is unavailable or the user cancels, the vault persists without a wrapper and the UI stays on Option D re-entry. Public campaign copy now distinguishes encrypted persistence from government delivery disclosure instead of making absolute address-disposal claims. | Passed focused PRF/vault Vitest, focused ground-vault helper `tsc`, `convex codegen --typecheck=disable`, diff whitespace check, stale absolute-address-copy sweep, and filtered Svelte check for new T6 files. Filtered Svelte check including `src/routes/c/[slug]/+page.svelte` still reports pre-existing campaign page diagnostics for `debateSignal`, `stats`, `orgAvatar`, and `targets`; the T6 campaign edit there was copy-only. |
| T7 tests, telemetry, release gate | Complete, launch-gated | Completed reconciliation pass 3: active architecture, congressional, frontend, help/integrity, design-pattern, jurisdiction, integration, proof UX, ZK spec, database, and voice docs now use ground-vault language. Active-doc stale sweep is clean for address-custody overclaims when excluding archive/history docs, intentional audit quotes, and this guardrail document. Brutalist gate ran with Gemini after Codex quota failed; accepted findings were patched: vault AAD is no longer bound to rotating district credential ids, deprecated encrypted-blob Convex/browser helpers now fail closed, legacy identity-blob storage docs/tests are marked retired, and local resolver comments no longer imply enclave-grade memory isolation. | Canonical language remains the ground-vault model: encrypted server-side vault custody, disclosed H3/cell metadata, PRF unlock when supported, re-entry fallback, and plaintext only in memory at government delivery boundaries. Public congressional launch is still blocked by `FEATURES.CONGRESSIONAL=false`; enabling it also exposes the existing Tier 4+ submission authority gate. New findings: several docs had conflated public/reporting privacy with official CWC delivery, which is wrong because government delivery can require plaintext address fields; delivery-path proof verification/geocoding are still synchronous resolver costs and need a load/isolation release gate before high-volume launch. Archive docs still preserve historical/superseded language and are treated as evidence, not current guidance. | Passed focused PRF/vault/blob-retirement Vitest (25 tests), focused identity helper `tsc`, filtered Svelte check for touched identity/resolver/profile/help/template files, `convex codegen --typecheck=disable`, active address-copy sweep, deprecated-path sweep, and `git diff --check`. Repo-wide checks still have unrelated baseline diagnostics in Convex/test/campaign-page areas, so release signoff should use the focused gates above until the broader baseline is burned down. |

### T0: PRF Reality Audit

- Build a measured PRF support matrix for Chrome, Edge, Firefox, Safari,
  iOS Safari, Chrome Android, Samsung Internet, and embedded WebViews.
- Test authenticators/providers: platform passkeys, iCloud Keychain, Google
  Password Manager, Windows Hello, 1Password, Dashlane, YubiKey 5+.
- Record support separately for `create()` and `get()` PRF.
- Implement capability probe using `getClientCapabilities()` plus an actual
  assertion-extension result check.

Gate: Option D receives equal design and test budget unless measured target
usage shows PRF `get()` works for the large majority of real users.

### T1: Data Model

- Add `groundVaults`.
- Add `groundCellMetadata` or extend `districtCredentials` with equivalent
  first-class fields. Do not duplicate active source of truth.
- Add `passkeyVaultWrappers` with one-to-many credential support.
- Add per-recipient delivery receipt rows.
- Add schema version and AEAD associated-data contract for vault envelopes.
- Add signing key id/history for resolve-result provenance.

Gate: A single Convex mutation can atomically persist vault ciphertext, cell
metadata, active credential link, and wrapper metadata.

### T2: PRF Crypto Service

- Implement passkey registration/authentication endpoints with PRF extension
  support.
- Derive wrapping keys with explicit domain separation.
- Support multiple wrappers, PRF salt rotation, DEK rotation after credential
  compromise, and all-wrappers-dead retirement.
- Do not send PRF outputs to the server. Strip extension results before server
  verification payloads where library helpers would serialize them.

Gate: Tests cover PRF unlock, unsupported PRF fallback, lost credential,
multi-passkey unwrap, wrapper revoke, DEK rotate, and salt rotate.

### T3: Canonical GroundService API

- Centralize resolve, attest, persist, restore, re-ground, vault unlock, and
  delivery-readiness logic.
- Move profile, onboarding, template modal, homepage, `/s/[slug]`, and
  campaign paths onto this service.
- Replace `clearSessionCredential()` during re-grounding with tree-state-only
  cleanup unless the user is intentionally rotating identity.
- Persist signed resolve result hash and server-derived cell/district metadata.

Gate: No direct caller can issue verified ground state outside GroundService.

### T4: UI State Integration

- Profile states:
  - Address saved
  - Saved address locked
  - Re-enter address
  - Address updated
  - Proof credentials missing
  - Delivery queued / delivered / partial / failed
- Keep crypto terms out of primary copy.
- Use popovers/detail text for: passkey unlock, encrypted address vault,
  disclosed cell, and government delivery plaintext requirement.
- Treat restore and re-ground as different flows.

Gate: A user who clears browser storage still sees why verification remains and
what is needed for delivery.

### T5: Delivery Integration

- Build delivery witness from canonical GroundVault unlock or Option D re-entry.
- Enforce witness retry TTL, cleanup pagination, and alerting for expired
  retained witnesses.
- Add per-recipient receipts for House/Senate/office outcomes.
- Add timeouts, retry budgets, and idempotency for resolver, Atlas, proxy, and
  upstream CWC calls.

Gate: CWC plaintext disclosure is constrained to the delivery boundary and
reflected honestly in docs/copy.

### T6: Migration And Retired Paths

Retire these trajectories as implementation advances:

- `/api/c/[slug]/verify-district` public verification as a trusted path.
- Campaign inline address verification that stores address by email.
- Direct `/api/identity/verify-address` callers outside GroundService.
- Device-key-only address ciphertext after migration window.
- `clearSessionCredential()` as the default re-ground cleanup.
- Any report that labels self-reported `districtCode` or `h3Cell` as verified.

Migration order:

1. Add new schema and services.
2. Dual-write old and new ground state.
3. Switch reads to new ground state.
4. Block new writes to deprecated paths.
5. Backfill or re-enter users who cannot rewrap.
6. Remove old callers and stale copy.
7. Drop legacy reads after the defined sunset.

Gate: Every deprecated path has an owner, deletion condition, and sunset date.

### T7: Tests And Release

- State-machine tests for every profile and delivery state.
- E2E tests:
  - PRF unlock on capable browser/provider.
  - PRF unsupported -> re-enter -> same-cell restore.
  - Re-enter -> different-cell re-ground.
  - Browser storage erased with server credential intact.
  - Legacy device-key vault migrates idempotently.
  - Vault retired while delivery witness is in flight.
  - Delivery receipt shows queued, partial, delivered, failed, and demo.
- Security tests:
  - Client cannot assert same-cell restore.
  - Self-reported campaign location cannot become verified ground.
  - PRF outputs never reach server logs/payloads.
  - Address plaintext absent from storage/logging outside explicit boundaries.

Gate: Release requires passing tests and a privacy-copy audit.

## Brutalist Review Gates

These gates are intentionally adversarial. They are not optional polish.

### BG-0: PRF Reality

If PRF `get()` is unavailable on a meaningful target share, Option D is not a
fallback in product planning. It is the main path for those users.

### BG-1: Privacy Truth

No "server never sees your address" claim while server-side geocoding or
`LocalConstituentResolver` handles plaintext in memory. Use the accurate
distinction: encrypted at rest, unlocked for delivery, plaintext submitted only
where government APIs require it.

### BG-2: Authority Consistency

AccountProof, GroundVault, GroundCell, DeviceGroundCache, and DeliveryWitness
must each have one authority. UI may compose them; it may not infer one from
another.

### BG-3: Atomic Ground Writes

Vault ciphertext, wrapper metadata, cell metadata, and district credential link
must commit atomically or not at all. Retry must be idempotent.

### BG-4: Server-Side Restore Decision

Same-cell restore and different-cell re-grounding are server decisions based on
signed resolution and documented drift tolerance.

### BG-5: DEK Lifecycle

Wrapper deletion is not compromise recovery. Compromise recovery requires DEK
rotation and re-encryption under remaining valid wrappers.

### BG-6: Delivery Honesty

"Delivered" means delivered. Queued, demo, partial, retrying, and failed are
separate user-visible states.

### BG-7: Deprecated Path Closure

No implementation can remain on a parallel old trust path. Deprecated paths must
be unreachable before the feature is called complete.

### BG-8: Delivery Load Boundary

The resolver path runs proof verification and address reconciliation before CWC
delivery. High-volume launch requires a measured isolation plan: bounded worker
concurrency, geocode/cache strategy, retry backoff, and alerting on verifier or
Shadow Atlas saturation. The current local resolver is acceptable only as a
bounded-memory delivery worker, not a horizontally unbounded request path.
