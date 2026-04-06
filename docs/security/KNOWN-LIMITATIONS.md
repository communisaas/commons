# Known Security Limitations

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
