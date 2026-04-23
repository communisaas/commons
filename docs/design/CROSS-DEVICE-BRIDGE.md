# Cross-Device Verification Bridge

## Purpose

When the user's desktop browser doesn't support the W3C Digital Credentials API (Firefox, older browsers, embedded webviews), verification must happen on a phone that does. The bridge mediates this cross-device flow.

**For Chrome 141+ and Safari 26+ on mobile, the bridge is not needed** — the DC-API handles in-wallet verification on the same device.

> ⚠️ **2026-04-23 audit — correction to the "no bridge needed" claim:**
> the original wording conflated **native-wallet CTAP2 hybrid** (which
> iOS/Android wallets use internally) with **what DC-API exposes to web
> apps** (same-device only). On **desktop** Chrome/Safari,
> `shouldUseSameDeviceFlow()` (`src/lib/core/identity/digital-credentials-api.ts:~44-46`)
> returns `false` and the bridge is **required**. Core crypto claims
> (KV + SSE + HMAC, AES-256-GCM + HKDF via `bridge-crypto.ts`, 3-word
> pairing code) all verify correctly against code.
>
> - **OID4VP JWT signature verification is now implemented**
>   (`mdl-verification.ts:~459-514, 623-704`, ES256/ES384/ES512, JWK +
>   x5c key extraction) — reflects the wave-9 KNOWN-LIMITATIONS
>   update. This bridge doc doesn't mention it because it scopes to
>   `org-iso-mdoc`; that's fine, but cross-link for completeness.
> - **mdoc nonce validation is partial.** OID4VP path verifies nonce
>   in the token; `org-iso-mdoc` path enforces nonce presence only —
>   full SessionTranscript binding and DeviceAuth HPKE verification
>   remain deferred to **T3 (Phase 2)**.
> - **Workers KV is eventually consistent;** `bridge-session.ts:~262-264`
>   documents the known race. Mitigations live in KNOWN-LIMITATIONS.md.

## Architecture

```
Desktop (no DC-API)              Server (KV + SSE)           Phone (has DC-API)
───────────────────              ─────────────────           ──────────────────
POST /bridge/start ────────►  Create bridge session
  ◄── {sessionId, qrUrl,       in KV (5-min TTL)
       pairingCode}

Show QR + pairing code
Open SSE /bridge/stream/{id}
  ◄── heartbeat (15s)                                       User scans QR
                                                             Page loads (GET)
                                                             User clicks "Continue"
  ◄── claimed ◄─────────────  status → claimed ◄──────────  POST /bridge/claim (HMAC)
                                                             User confirms email + code
                                                             Wallet responds
                                                             POST /bridge/complete (HMAC)
  ◄── completed ◄───────────  processCredentialResponse()    Privacy boundary
    {district, state,           Stores derived facts
     cellId, committed}         Clears secret + key

Desktop shows success          Session deleted (TTL)         Phone shows "return to desktop"
```

## Security Model

- **QR = shared secret** — URL fragment contains 256-bit secret (never hits server)
- **HMAC proof of possession** — /claim and /complete verify via HMAC without receiving the secret
- **Email hash anti-phishing** — server verifies client-supplied email hashes to stored emailHash
- **Pairing code** — 3-word phrase displayed on both devices for visual confirmation
- **One-way state transitions** — pending → claimed → completed (irreversible)
- **Encrypted-at-rest** — sensitive KV fields encrypted with AES-256-GCM + HKDF
- **Explicit user gesture** — page load doesn't auto-claim (prevents link-preview DoS)
- **Canonical origin** — QR URL uses PUBLIC_APP_URL (fail-closed in production)

## Files

| File | Purpose |
|------|---------|
| src/lib/server/bridge-session.ts | Session model + KV lifecycle |
| src/lib/server/bridge-crypto.ts | AES-256-GCM encryption for KV fields |
| src/routes/api/identity/bridge/start/ | Create bridge session |
| src/routes/api/identity/bridge/claim/ | HMAC-authenticated claim |
| src/routes/api/identity/bridge/complete/ | Process credential + bind identity |
| src/routes/api/identity/bridge/stream/ | SSE notification to desktop |
| src/routes/verify-bridge/[sessionId]/ | Mobile verification page |
| src/lib/components/auth/GovernmentCredentialVerification.svelte | Desktop component |

## Phase 2: Durable Objects

When bridge traffic justifies the cost, migrate from KV to Durable Objects for true atomic state transitions. See docs/security/KNOWN-LIMITATIONS.md.
