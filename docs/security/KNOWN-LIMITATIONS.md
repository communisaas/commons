# Known Security Limitations

> ⚠️ **ADDENDA (2026-04-23 audit) — status updates + missing entries:**
>
> **Flip / reframe existing rows:**
>
> - **OID4VP JWT signature verification** is now **implemented**, not
>   "Planned" — full ES256/ES384/ES512 verification in
>   `verifyVpTokenSignature()` (~lines 623-704 of the DCAPI handler),
>   with x5c-only issuer trust anchored to IACA roots. Header `jwk`
>   keys are rejected because they do not establish issuer trust.
> - **mdoc nonce:** doc previously "Planned." Reality is partial —
>   nonce *presence* is required and validated in the OID4VP path;
>   **transcript binding (SessionTranscript extraction → deviceAuth
>   HPKE)** is still deferred to T3. Reframe as "partial, T3 pending."
> - **`SKIP_ISSUER_VERIFICATION` bypass** was removed from verifier code.
>   `tests/unit/identity/issuer-bypass-removed.test.ts` guards against
>   reintroduction.
>
> **Missing entries to add (material gaps):**
>
> - **Storacha pinning sunset (2026-05-31) — operationally urgent.**
>   Uploads disabled 2026-04-15. `pin-to-ipfs.ts` hardcodes Storacha;
>   `storacha.link/ipfs` gateway will 404 after sunset. Shadow-Atlas
>   pinning provider migration required. Severity: **CRITICAL** (fixed
>   deadline, no fallback wired).
> - **TEE is MVP-only — `LocalConstituentResolver`, not an attested
>   enclave.** Witness decryption runs in-process in the CF Worker
>   runtime. Nitro deployment is Phase 2 (see
>   `docs/implementation-status.md`). The prior entry framed TEE as
>   shippable; treat as gap.
> - **Client storage lacks per-user keying.** `templateDraftStore`,
>   search cache, trade preimages all use globally-keyed localStorage /
>   IndexedDB entries; shared devices can read another user's drafts.
>   See MEMORY `storage_isolation_gaps.md`.
> - **`FEATURES.PASSKEY=false`** — passkey authentication routes exist
>   but are not the live sign-in path. Treat any claim that WebAuthn
>   is a live auth channel as aspirational.

## Workers KV Eventual Consistency (Bridge Sessions)

The cross-device verification bridge uses Cloudflare Workers KV for ephemeral session state. KV is eventually consistent — concurrent reads can return stale data.

**Impact:** The `claimBridgeSessionBestEffort()` function performs a read-modify-write without atomic compare-and-set. Two devices scanning the same QR code simultaneously could both claim the session.

**Mitigations in place:**
- 256-bit HMAC secret required for both claim and completion (limits races to QR-secret holders)
- 5-minute TTL limits the race window
- Only the first device to call `/complete` binds the identity (second gets 409)
- Secret + private key cleared on terminal states

**Upgrade path:** Cloudflare Durable Objects provide single-threaded per-ID state machines with strong consistency. Migration planned for Phase 2 when bridge traffic justifies the infrastructure cost ($0.15/million requests).

## Issuer Verification Bypass Removed

The mDL verification pipeline no longer has an environment-variable bypass for issuer verification. OpenID4VP always verifies the JWT/SD-JWT signature through an x5c certificate anchored to IACA roots, and raw mdoc always requires issuerAuth when that protocol is enabled.

**Status:** Removed in the Android OpenID4VP hardening pass. Unit tests now use signed x5c fixtures for OID4VP and module-level COSE mocks for synthetic raw mdoc fixtures.

**Regression guard:** `tests/unit/identity/issuer-bypass-removed.test.ts` asserts the verifier source does not contain `SKIP_ISSUER_VERIFICATION`, `shouldBypassIssuerVerification`, or `process.env.NODE_ENV`.

## Pre-existing Verification Gaps

The following gaps exist in `src/lib/core/identity/mdl-verification.ts` and are being addressed in Phase 0:

| Gap | Status | Task |
|-----|--------|------|
| OID4VP JWT signature not verified | Implemented (2026-04) | T1 ✓ |
| mdoc nonce binding to SessionTranscript | **Partial — DeviceAuth presence gate only; full T3 pending** | T3 (mDL launch gate) |
| DeviceAuth (HPKE) not implemented | Deferred — REQUIRED before mDL launch flag flip | T3 |

### F-1.3 — mdoc DeviceAuth nonce-binding partial closure (2026-04-25)

**Threat**: Replay/relay of captured mdoc responses on the org-iso-mdoc path
(Safari/iOS native, Android Digital Credentials API). A captured `DeviceResponse`
can be re-submitted by an attacker against any later `verify-mdl/start` nonce.

**Replay window** (corrected after review round 2 — earlier framing was wrong):
On the org-iso-mdoc path, the `nonce` parameter is checked for *presence* but
NEVER extracted from the response or compared against `deviceAuth`. The
verification therefore does not bound the replay window by the OID4VP nonce
TTL. **A captured mdoc response remains replayable until the wallet rotates the
device-bound key in the credential** — which for AAMVA-issued mDLs is typically
the credential's `validFrom`/`validUntil` window (months to years), not minutes.
This is a structural exposure, not a bounded incident, until T3 ships.

**What's protected today**:
- COSE_Sign1 IACA root verification — proves the mDL itself was issued by a
  state in our trust store; not forgeable.
- MSO digest validation — proves extracted field values match signed digests.
- OID4VP-path nonce check (only when `protocol === 'openid4vp'`) — JWT-claims
  nonce is compared to the issued request nonce. **Does not apply to org-iso-mdoc.**
- **DeviceAuth presence gate (F-1.3, narrow scope)**: `processMdocResponse`
  rejects with `replay_protection_missing` when `deviceSigned.deviceAuth` is
  absent or has neither `deviceMac` nor `deviceSignature`. This rejects
  non-conformant wallets (negligent vendors, broken test rigs); it provides
  **zero defense against capture-replay** because the captured bytes pass
  the presence check trivially.

**What's NOT protected**:
- DeviceAuth bytes are NOT verified. Cryptographic binding of the response to
  OUR session requires reconstructing the SessionTranscript from the OID4VP
  request + ephemeral key material and verifying `deviceMac` / `deviceSignature`
  against it. That is T3.
- Reader authentication (`ReaderAuthentication`) is NOT included in the
  request — `verify-mdl/start` omits `readerAuth`. When T3 lands the
  reconstructed SessionTranscript will be reader-less, so a captured
  reader-less response could in principle be replayed at any other reader-less
  verifier (mitigated weakly by `eDeviceKey` mismatch enforced via HPKE).

**Defense-in-depth (deferred — H-1)**: a credentialHash re-use cool-down
(detect: same `credentialHash` from two `userId`s within N minutes) is the
cheapest pre-T3 mitigation against the stated threat. Not implemented today.

**Launch gate**: T3 must ship before the raw mdoc flag (`FEATURES.MDL_MDOC`) is
flipped true. Android OpenID4VP can remain enabled through
`FEATURES.MDL_ANDROID_OID4VP`; the raw mdoc lane remains closed until
SessionTranscript reconstruction and DeviceAuth verification are complete. See
`docs/design/BRUTALIST-AUDIT-2026-04-25.md` finding F-1.3 for the full
decision rationale.
