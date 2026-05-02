# Known Security Limitations

> ⚠️ **ADDENDA (2026-04-23 audit) — status updates + missing entries:**
>
> **Flip / reframe existing rows:**
>
> - **OID4VP JWT-era controls are no longer live launch controls.** DC-4
>   deleted the custom direct-post verifier and rejects JWT/string VP tokens,
>   raw compact JWE, and `identityToken` response shapes. Browser-mediated
>   OpenID4VP now accepts only encrypted `dc_api.jwt` envelopes carrying
>   `mso_mdoc` DeviceResponse payloads.
> - **OpenID4VP mdoc nonce/origin binding is live on the signed DC API path.**
>   The verifier reconstructs the DC API SessionTranscript and verifies mDL
>   DeviceAuth for encrypted `mso_mdoc` responses. The raw `org-iso-mdoc`
>   lane remains disabled until Apple/Safari ReaderAuth and response handling
>   are implemented.
> - **`SKIP_ISSUER_VERIFICATION` bypass** was removed from verifier code.
>   `tests/unit/identity/issuer-bypass-removed.test.ts` guards against
>   reintroduction.
>
> **Missing entries to add (material gaps):**
>
> - **(RESOLVED 2026-05-02)** Storacha pinning sunset (2026-05-31).
>   Uploads were disabled 2026-04-15. Resolved by removing Storacha
>   from voter-protocol and pausing IPFS pinning rather than swapping
>   providers. R2 (`atlas.commons.email`) carries the production read
>   path. Pinata/Lighthouse/Fleek implementations preserved for
>   future reactivation when IPFS matures.
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

## Issuer Verification Bypass Removed

The mDL verification pipeline no longer has an environment-variable bypass for issuer verification. Browser-mediated OpenID4VP accepts only encrypted `dc_api.jwt` responses carrying issuer-signed `mso_mdoc` DeviceResponse payloads, and raw mdoc always requires issuerAuth when that protocol is enabled.

**Status:** Removed in the OpenID4VP hardening pass. Unit tests now use encrypted DC API `mso_mdoc` fixtures for OID4VP and module-level COSE mocks for synthetic raw mdoc fixtures.

**Regression guard:** `tests/unit/identity/issuer-bypass-removed.test.ts` asserts the verifier source does not contain `SKIP_ISSUER_VERIFICATION`, `shouldBypassIssuerVerification`, or `process.env.NODE_ENV`.

## Pre-existing Verification Gaps

The following gaps exist in `src/lib/core/identity/mdl-verification.ts` and are being addressed in Phase 0:

| Gap | Status | Task |
|-----|--------|------|
| OID4VP JWT signature not verified | Deleted/non-launch path after DC-4; JWT/string VP tokens are rejected | DC-4 ✓ |
| Signed OpenID4VP `mso_mdoc` nonce binding to SessionTranscript | Implemented for encrypted `dc_api.jwt` responses | DC-3a/DC-4 ✓ |
| Raw `org-iso-mdoc` DeviceAuth/ReaderAuth | Deferred — REQUIRED before Apple/Safari/raw mdoc launch flag flip | DC-5 |

### F-1.3 — mdoc DeviceAuth nonce-binding partial closure (2026-04-25)

**Threat**: Replay/relay of captured mdoc responses on the raw org-iso-mdoc path
(Safari/iOS native when enabled). A captured `DeviceResponse` can be
re-submitted by an attacker against any later `verify-mdl/start` nonce.

**Replay window** (corrected after review round 2 — earlier framing was wrong):
On the org-iso-mdoc path, the `nonce` parameter is checked for *presence* but
NEVER extracted from the response or compared against `deviceAuth`. The
verification therefore does not bound the replay window by the OID4VP nonce
TTL. **A captured mdoc response remains replayable until the wallet rotates the
device-bound key in the credential** — which for AAMVA-issued mDLs is typically
the credential's `validFrom`/`validUntil` window (months to years), not minutes.
This is a structural exposure, not a bounded incident, until DC-5 ships.

**What's protected today**:
- COSE_Sign1 IACA root verification — proves the mDL itself was issued by a
  state in our trust store; not forgeable.
- MSO digest validation — proves extracted field values match signed digests.
- Signed OpenID4VP-path DeviceAuth check — the encrypted `mso_mdoc`
  DeviceResponse is verified against the issued DC API nonce and origin-bound
  SessionTranscript. **Does not apply to org-iso-mdoc.**
- **DeviceAuth presence gate (F-1.3, narrow scope)**: `processMdocResponse`
  rejects with `replay_protection_missing` when `deviceSigned.deviceAuth` is
  absent or has neither `deviceMac` nor `deviceSignature`. This rejects
  non-conformant wallets (negligent vendors, broken test rigs); it provides
  **zero defense against capture-replay** because the captured bytes pass
  the presence check trivially.

**What's NOT protected on raw `org-iso-mdoc`**:
- Raw mdoc DeviceAuth bytes are NOT verified. Cryptographic binding of the
  response to OUR session requires reconstructing the raw mdoc
  SessionTranscript from the request + ephemeral key material and verifying
  `deviceMac` / `deviceSignature` against it. That is DC-5.
- Reader authentication (`ReaderAuthentication`) is NOT included in the raw mdoc
  request — `verify-mdl/start` omits `readerAuth`. When DC-5 lands the
  reconstructed SessionTranscript will be reader-less, so a captured
  reader-less response could in principle be replayed at any other reader-less
  verifier (mitigated weakly by `eDeviceKey` mismatch enforced via HPKE).

**Defense-in-depth (deferred — H-1)**: a credentialHash re-use cool-down
(detect: same `credentialHash` from two `userId`s within N minutes) is the
cheapest pre-T3 mitigation against the stated threat. Not implemented today.

**Launch gate**: DC-5 must ship before the raw mdoc flag (`FEATURES.MDL_MDOC`)
or iOS lane (`FEATURES.MDL_IOS`) is flipped true. Signed OpenID4VP can remain
enabled through `FEATURES.MDL_ANDROID_OID4VP`; raw mdoc remains closed until
Apple/Safari ReaderAuth, response handling, SessionTranscript reconstruction,
and DeviceAuth verification are complete.
