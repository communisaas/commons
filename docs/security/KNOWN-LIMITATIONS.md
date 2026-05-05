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
> - **OpenID4VP mdoc nonce/origin binding is live on BOTH the signed DC API
>   path AND the raw `org-iso-mdoc` path** (I1, 2026-05-04). The verifier
>   reconstructs the DC API SessionTranscript and verifies mDL DeviceAuth via
>   a shared `verifyMdocDeviceAuth` helper called from both lanes. The raw
>   lane (`FEATURES.MDL_MDOC = false` today) is now ready for the flag flip
>   from a security standpoint; remaining work is Apple/Safari ReaderAuth and
>   raw-mdoc-specific response handling, both ops/integration concerns.
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
> - **(RESOLVED 2026-05-04, I3)** Chunked-atlas R2 read path lacked
>   integration test coverage (#22 since storacha sunset). Now exercised
>   end-to-end in `tests/integration/ipfs-chunked-atlas.test.ts` with
>   mocked fetch responses covering manifest reads, chunk-for-cell with
>   H3 parent computation, district index, 404 → null mapping, 5xx
>   throw, network failure throw, and path-traversal hardening.
> - **TEE is MVP-only — `LocalConstituentResolver`, not an attested
>   enclave.** Witness decryption runs in-process in the CF Worker
>   runtime. Nitro deployment is J-phase (see
>   `voter-protocol/specs/I-PHASE-SCOPE.md` §6 post-launch ledger and
>   `docs/implementation-status.md`). The prior entry framed TEE as
>   shippable; treat as gap.
> - **Client storage lacks per-user keying.** `templateDraftStore`,
>   search cache, trade preimages all use globally-keyed localStorage /
>   IndexedDB entries; shared devices can read another user's drafts.
>   See MEMORY `storage_isolation_gaps.md`.
> - **`FEATURES.PASSKEY=false`** — passkey authentication routes exist
>   but are not the live sign-in path. Treat any claim that WebAuthn
>   is a live auth channel as aspirational.
> - **(NEW 2026-05-04, I2)** Boundary-cell observability — the H1
>   `cellStraddles` field now powers a Convex cron alert that fires when
>   the trailing-24h boundary-cell rate exceeds 28% (CA G3 baseline:
>   ~16.4%). Alert fan-out reaches Sentry via `/api/internal/alert`.
>   Alert payload is aggregate-counts only — no user IDs or hashes. Cron
>   schedule: every 60 minutes (`monitor-boundary-cell-rate`). Threshold
>   re-tuning is required if multi-state launch shifts the baseline.

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
| Raw `org-iso-mdoc` DeviceAuth (deviceSignature against reconstructed SessionTranscript) | **Implemented (I1, 2026-05-04)** — shared `verifyMdocDeviceAuth` helper called from both lanes | DC-5 ✓ |
| Raw `org-iso-mdoc` ReaderAuth + Apple/Safari handover handling | Deferred — required for actual `MDL_MDOC` flag flip; I1 closed the cryptographic gate, ops/integration remain | future epic |

### F-1.3 / I1 — mdoc DeviceAuth full closure (2026-05-04)

**Status: closed via I1.** The raw `org-iso-mdoc` path now performs full
DeviceAuth verification using the shared `verifyMdocDeviceAuth` helper in
`src/lib/core/identity/mdl-verification.ts`. Both lanes — encrypted
`dc_api.jwt` (DC-3a/DC-4) and raw `org-iso-mdoc` (I1) — call the same helper
after MSO digest validation, reconstructing SessionTranscript from
`(verifierOrigin, nonce, jwkThumbprint)` and verifying the
COSE_Sign1 deviceSignature against the canonical DeviceAuthenticationBytes
per ISO 18013-5 §9.1.3.6.

**Original threat (pre-I1)**: replay/relay of captured mdoc responses on the
raw org-iso-mdoc path. A captured `DeviceResponse` could be re-submitted
against any later `verify-mdl/start` nonce. The pre-I1 partial gate (F-1.3,
2026-04-25) only checked deviceAuth structure presence; it provided zero
defense against capture-replay.

**Post-I1 protection**: a captured response replayed in a fresh session fails
because the new session's nonce + jwkThumbprint differ from the bytes the
wallet originally signed. The replay window is now bounded by the OID4VP
nonce TTL, not by the credential's `validUntil`.

**Remaining gaps (post-I1, scoped for the future Apple/Safari epic)**:
- `ReaderAuthentication` is still NOT included in the raw mdoc request —
  `verify-mdl/start` omits `readerAuth`. The reconstructed SessionTranscript
  on the raw path is reader-less, so a captured reader-less response could in
  principle be replayed at any *other* reader-less verifier. Mitigated weakly
  by `eDeviceKey` mismatch enforced via HPKE; closing this fully requires
  ReaderAuth wiring on raw-mdoc requests.
- The `MDL_MDOC` flag remains `false` until Apple/Safari handover handling is
  complete. I1 closed the cryptographic gate; the ops/integration story for
  in-person NFC/BLE flows is a separate launch decision.

**Shared helper as forward investment**: future protocol additions (e.g.,
ReaderAuth-bound paths) can call the same helper, inheriting the
SessionTranscript binding by construction.
