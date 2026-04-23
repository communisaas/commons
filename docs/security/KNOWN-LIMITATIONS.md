# Known Security Limitations

> ⚠️ **ADDENDA (2026-04-23 audit) — status updates + missing entries:**
>
> **Flip / reframe existing rows:**
>
> - **OID4VP JWT signature verification** is now **implemented**, not
>   "Planned" — full ES256/ES384/ES512 verification in
>   `verifyVpTokenSignature()` (~lines 623-704 of the DCAPI handler),
>   with JWK + x5c key extraction and constant-time signature compare.
> - **mdoc nonce:** doc previously "Planned." Reality is partial —
>   nonce *presence* is required and validated in the OID4VP path;
>   **transcript binding (SessionTranscript extraction → deviceAuth
>   HPKE)** is still deferred to T3. Reframe as "partial, T3 pending."
> - **`SKIP_ISSUER_VERIFICATION` bypass** remains in production code
>   (gated, logged, test-only) — keep the entry but clarify it's active
>   behind an env-flag.
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

## SKIP_ISSUER_VERIFICATION Test Bypass

The mDL verification pipeline has a `SKIP_ISSUER_VERIFICATION` environment variable that bypasses COSE signature verification. This is used ONLY in unit tests with synthetic CBOR data that lacks real IACA-signed issuerAuth.

**Status:** Will be removed when T1-T3 (crypto verification hardening) ships with proper test fixtures and module-level mocks.

**Production safety:** The env var is never set in production deployments. The bypass paths log warnings when active.

## Pre-existing Verification Gaps

The following gaps exist in `src/lib/core/identity/mdl-verification.ts` and are being addressed in Phase 0:

| Gap | Status | Task |
|-----|--------|------|
| OID4VP JWT signature not verified | In progress | T1 |
| mdoc nonce not validated | Planned | T2 |
| DeviceAuth (HPKE) not implemented | Planned | T3 |
